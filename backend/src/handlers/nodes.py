"""Node-related Lambda handlers."""

import json
import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List
from urllib import error, request

from lib.auth import require_auth
from lib.dynamodb import (
    batch_delete_nodes,
    collect_subtree_nodes,
    get_node,
    get_nodes_table,
    query_nodes_by_canvas,
    query_nodes_by_parent,
    require_membership,
    upsert_canvas_presence,
    list_canvas_presence,
)
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.s3 import batch_delete_s3_objects, extract_file_s3_keys_from_nodes
from lib.validation import (
    parse_body,
    parse_query_params,
    validate_approval_mode,
    validate_approval_decision,
    validate_activity_log,
    validate_approval_requests,
    validate_assigned_to,
    validate_canvas_id,
    validate_inputs_outputs,
    validate_iso8601,
    validate_node_status,
    validate_node_id,
    normalize_evidence,
)

logger = get_logger(__name__)
PRESENCE_ACTIVE_WINDOW_SECONDS = 30


def get_nodes(event, context):
    """GET /nodes - List nodes for a canvas, optionally filtered by parent and updatedSince."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Parse query parameters
        params = parse_query_params(event)

        canvas_id = params.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId query parameter is required",
            )

        # Validate canvas ID
        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Check membership
        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        claims = (
            event.get("requestContext", {})
            .get("authorizer", {})
            .get("jwt", {})
            .get("claims", {})
        )
        display_name = (
            claims.get("email")
            or claims.get("cognito:username")
            or claims.get("username")
            or f"User {user_sub[-4:]}"
        )
        upsert_canvas_presence(canvas_id, user_sub, display_name)

        # Get parent node ID (default to ROOT)
        parent_node_id = params.get("parentNodeId", "ROOT")
        include_all = params.get("includeAll", "").lower() in ("1", "true", "yes")

        # Get updatedSince if provided
        updated_since = params.get("updatedSince")
        if updated_since:
            valid, error_msg = validate_iso8601(updated_since)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        # Query nodes
        if include_all:
            nodes = query_nodes_by_canvas(canvas_id, updated_since)
        else:
            nodes = query_nodes_by_parent(canvas_id, parent_node_id, updated_since)

        active_since = (datetime.utcnow() - timedelta(seconds=PRESENCE_ACTIVE_WINDOW_SECONDS)).isoformat() + "Z"
        active_users = list_canvas_presence(canvas_id, active_since)

        logger.info(
            f"Retrieved {len(nodes)} nodes for canvas {canvas_id}, "
            f"parent {parent_node_id}, includeAll={include_all}"
        )

        return success_response({
            "nodes": nodes,
            "activeUsers": active_users,
        })

    except Exception as e:
        logger.error(f"Error getting nodes: {str(e)}", exc_info=True)
        return internal_error_response("Failed to get nodes")


def get_node_by_id(event, context):
    """GET /nodes/{nodeId} - Get a single node by ID."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        path_params = event.get("pathParameters") or {}
        node_id = path_params.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId path parameter is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        params = parse_query_params(event)
        canvas_id = params.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId query parameter is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        return success_response(node)

    except Exception as e:
        logger.error(f"Error getting node: {str(e)}", exc_info=True)
        return internal_error_response("Failed to get node")


def create_node(event, context):
    """POST /nodes - Create a new node."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Parse request body
        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        # Validate required fields
        canvas_id = body.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Check membership
        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        # Get parent node ID (default to ROOT)
        parent_node_id = body.get("parentNodeId", "ROOT")

        # Validate title
        title = body.get("title")
        if not title or not isinstance(title, str):
            return error_response(
                code="INVALID_REQUEST",
                message="title is required and must be a non-empty string",
            )

        # Get optional fields
        description = body.get("description", "")
        inputs = body.get("inputs", [])
        outputs = body.get("outputs", [])
        evidence = body.get("evidence")
        approval_mode = body.get("approvalMode")
        assigned_to = body.get("assignedTo")
        status = body.get("status", "draft")
        activity_log = body.get("activityLog")
        approval_requests = body.get("approvalRequests")
        active_task_id = body.get("activeTaskId")
        position_x = body.get("x")
        position_y = body.get("y")

        # Validate inputs/outputs
        if inputs:
            valid, error_msg = validate_inputs_outputs(inputs)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        if outputs:
            valid, error_msg = validate_inputs_outputs(outputs)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        normalized_evidence, evidence_error = normalize_evidence(evidence)
        if evidence_error:
            return error_response(code="INVALID_REQUEST", message=evidence_error)

        if approval_mode is not None:
            valid, error_msg = validate_approval_mode(approval_mode)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        if assigned_to is not None:
            valid, error_msg = validate_assigned_to(assigned_to)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        if activity_log is not None:
            valid, error_msg = validate_activity_log(activity_log)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        if approval_requests is not None:
            valid, error_msg = validate_approval_requests(approval_requests)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        valid, error_msg = validate_node_status(status)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        if status == "completed" and assigned_to and assigned_to.get("type") == "agent":
            if not normalized_evidence:
                return error_response(
                    code="INVALID_REQUEST",
                    message="evidence is required before marking an agent-assigned node completed",
                )

        if position_x is not None or position_y is not None:
            if position_x is None or position_y is None:
                return error_response(
                    code="INVALID_REQUEST",
                    message="x and y must be provided together",
                )
            if not isinstance(position_x, (int, float)) or not isinstance(position_y, (int, float)):
                return error_response(
                    code="INVALID_REQUEST",
                    message="x and y must be numbers",
                )
            position_x = Decimal(str(position_x))
            position_y = Decimal(str(position_y))

        # Generate node ID
        node_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"

        item = {
            "PK": f"CANVAS#{canvas_id}",
            "SK": f"NODE#{node_id}",
            "GSI1PK": f"CANVAS#{canvas_id}#PARENT#{parent_node_id}",
            "GSI1SK": f"UPDATED#{now}#NODE#{node_id}",
            "nodeId": node_id,
            "canvasId": canvas_id,
            "parentNodeId": parent_node_id,
            "title": title,
            "description": description,
            "inputs": inputs or [],
            "outputs": outputs or [],
            "evidence": normalized_evidence,
            "status": status,
            "approvalRequests": approval_requests or [],
            "activityLog": activity_log or [],
            "activeTaskId": active_task_id,
            "authorSub": user_sub,
            "createdAt": now,
            "updatedAt": now,
        }
        if approval_mode is not None:
            item["approvalMode"] = approval_mode
        if assigned_to is not None:
            item["assignedTo"] = assigned_to
        if position_x is not None and position_y is not None:
            item["x"] = position_x
            item["y"] = position_y

        table = get_nodes_table()
        table.put_item(Item=item)

        logger.info(f"Created node {node_id} in canvas {canvas_id}")

        node = {
            "nodeId": node_id,
            "canvasId": canvas_id,
            "parentNodeId": parent_node_id,
            "title": title,
            "description": description,
            "inputs": inputs or [],
            "outputs": outputs or [],
            "evidence": normalized_evidence,
            "status": status,
            "approvalMode": approval_mode,
            "assignedTo": assigned_to,
            "approvalRequests": approval_requests or [],
            "activityLog": activity_log or [],
            "activeTaskId": active_task_id,
            "authorSub": user_sub,
            "createdAt": now,
            "updatedAt": now,
        }
        if position_x is not None and position_y is not None:
            node["x"] = float(position_x)
            node["y"] = float(position_y)

        return success_response(node)

    except Exception as e:
        logger.error(f"Error creating node: {str(e)}", exc_info=True)
        return internal_error_response("Failed to create node")


def update_node(event, context):
    """PATCH /nodes/{nodeId} - Update an existing node (last-write-wins)."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Get node ID from path
        path_params = event.get("pathParameters") or {}
        node_id = path_params.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId path parameter is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Parse request body
        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        canvas_id = body.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId is required in request body",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Check membership
        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        # Verify node exists and belongs to canvas
        existing_node = get_node(canvas_id, node_id)
        if not existing_node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        # Build update expression
        update_expressions = []
        expression_attribute_names = {}
        expression_attribute_values = {}

        now = datetime.utcnow().isoformat() + "Z"

        # Always update updatedAt, authorSub, and GSI1SK
        update_expressions.append("SET updatedAt = :now, authorSub = :authorSub, GSI1SK = :gsi1sk")
        expression_attribute_values[":now"] = now
        expression_attribute_values[":authorSub"] = user_sub

        expression_attribute_values[":gsi1sk"] = f"UPDATED#{now}#NODE#{node_id}"

        # Handle optional fields
        assigned_to = None
        if "title" in body:
            update_expressions.append("#title = :title")
            expression_attribute_names["#title"] = "title"
            expression_attribute_values[":title"] = body["title"]

        if "description" in body:
            update_expressions.append("#description = :description")
            expression_attribute_names["#description"] = "description"
            expression_attribute_values[":description"] = body.get("description", "")

        if "inputs" in body:
            inputs = body["inputs"]
            valid, error_msg = validate_inputs_outputs(inputs)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            update_expressions.append("#inputs = :inputs")
            expression_attribute_names["#inputs"] = "inputs"
            expression_attribute_values[":inputs"] = inputs

        if "outputs" in body:
            outputs = body["outputs"]
            valid, error_msg = validate_inputs_outputs(outputs)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            update_expressions.append("#outputs = :outputs")
            expression_attribute_names["#outputs"] = "outputs"
            expression_attribute_values[":outputs"] = outputs

        requested_evidence = None
        if "evidence" in body:
            normalized_evidence, evidence_error = normalize_evidence(body.get("evidence"))
            if evidence_error:
                return error_response(code="INVALID_REQUEST", message=evidence_error)
            update_expressions.append("evidence = :evidence")
            expression_attribute_values[":evidence"] = normalized_evidence
            requested_evidence = normalized_evidence

        if "approvalMode" in body:
            approval_mode = body.get("approvalMode")
            valid, error_msg = validate_approval_mode(approval_mode)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            update_expressions.append("#approvalMode = :approvalMode")
            expression_attribute_names["#approvalMode"] = "approvalMode"
            expression_attribute_values[":approvalMode"] = approval_mode

        if "approvalRequests" in body:
            approval_requests = body.get("approvalRequests")
            valid, error_msg = validate_approval_requests(approval_requests)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            update_expressions.append("approvalRequests = :approvalRequests")
            expression_attribute_values[":approvalRequests"] = approval_requests or []

        if "activityLog" in body:
            activity_log = body.get("activityLog")
            valid, error_msg = validate_activity_log(activity_log)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            update_expressions.append("activityLog = :activityLog")
            expression_attribute_values[":activityLog"] = activity_log or []

        if "activeTaskId" in body:
            active_task_id = body.get("activeTaskId")
            if active_task_id is not None and not isinstance(active_task_id, str):
                return error_response(
                    code="INVALID_REQUEST",
                    message="activeTaskId must be a string or null",
                )
            update_expressions.append("activeTaskId = :activeTaskId")
            expression_attribute_values[":activeTaskId"] = active_task_id

        if "assignedTo" in body:
            assigned_to = body.get("assignedTo")
            valid, error_msg = validate_assigned_to(assigned_to)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            status_effective = body.get("status", existing_node.get("status"))
            if assigned_to.get("type") == "agent" and status_effective == "completed":
                evidence_to_check = requested_evidence
                if evidence_to_check is None:
                    evidence_to_check = existing_node.get("evidence", [])
                if not evidence_to_check:
                    return error_response(
                        code="INVALID_REQUEST",
                        message="evidence is required before marking an agent-assigned node completed",
                    )
            update_expressions.append("#assignedTo = :assignedTo")
            expression_attribute_names["#assignedTo"] = "assignedTo"
            expression_attribute_values[":assignedTo"] = assigned_to

        if "status" in body:
            status = body.get("status")
            valid, error_msg = validate_node_status(status)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)
            if status == "completed":
                assigned_to_effective = assigned_to
                if assigned_to_effective is None:
                    assigned_to_effective = existing_node.get("assignedTo")
                if assigned_to_effective and assigned_to_effective.get("type") == "agent":
                    evidence_to_check = requested_evidence
                    if evidence_to_check is None:
                        evidence_to_check = existing_node.get("evidence", [])
                    if not evidence_to_check:
                        return error_response(
                            code="INVALID_REQUEST",
                            message="evidence is required before marking an agent-assigned node completed",
                        )
            update_expressions.append("#status = :status")
            expression_attribute_names["#status"] = "status"
            expression_attribute_values[":status"] = status

        if "x" in body or "y" in body:
            if "x" not in body or "y" not in body:
                return error_response(
                    code="INVALID_REQUEST",
                    message="x and y must be provided together",
                )
            position_x = body.get("x")
            position_y = body.get("y")
            if not isinstance(position_x, (int, float)) or not isinstance(position_y, (int, float)):
                return error_response(
                    code="INVALID_REQUEST",
                    message="x and y must be numbers",
                )
            update_expressions.append("#x = :x")
            update_expressions.append("#y = :y")
            expression_attribute_names["#x"] = "x"
            expression_attribute_names["#y"] = "y"
            expression_attribute_values[":x"] = Decimal(str(position_x))
            expression_attribute_values[":y"] = Decimal(str(position_y))

        # Execute update
        table = get_nodes_table()
        update_expression = ", ".join(update_expressions)

        update_params = {
            "Key": {
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"NODE#{node_id}",
            },
            "UpdateExpression": update_expression,
            "ExpressionAttributeValues": expression_attribute_values,
            "ReturnValues": "ALL_NEW",
        }

        if expression_attribute_names:
            update_params["ExpressionAttributeNames"] = expression_attribute_names

        response = table.update_item(**update_params)
        updated_item = response["Attributes"]

        logger.info(f"Updated node {node_id} in canvas {canvas_id}")

        evidence, evidence_error = normalize_evidence(updated_item.get("evidence"))
        if evidence_error:
            evidence = []

        # Transform to API format
        updated_node = {
            "nodeId": updated_item["nodeId"],
            "canvasId": updated_item["canvasId"],
            "parentNodeId": updated_item["parentNodeId"],
            "title": updated_item["title"],
            "description": updated_item["description"],
            "inputs": updated_item.get("inputs", []),
            "outputs": updated_item.get("outputs", []),
            "evidence": evidence,
            "status": updated_item.get("status") or "draft",
            "approvalMode": updated_item.get("approvalMode"),
            "assignedTo": updated_item.get("assignedTo"),
            "approvalRequests": updated_item.get("approvalRequests", []),
            "activityLog": updated_item.get("activityLog", []),
            "activeTaskId": updated_item.get("activeTaskId"),
            "authorSub": updated_item["authorSub"],
            "createdAt": updated_item["createdAt"],
            "updatedAt": updated_item["updatedAt"],
        }
        if "x" in updated_item and "y" in updated_item:
            updated_node["x"] = float(updated_item["x"])
            updated_node["y"] = float(updated_item["y"])

        return success_response(updated_node)

    except Exception as e:
        logger.error(f"Error updating node: {str(e)}", exc_info=True)
        return internal_error_response("Failed to update node")


def delete_node(event, context):
    """DELETE /nodes/{nodeId} - Delete a node and all its descendants (cascade delete)."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Get node ID from path
        path_params = event.get("pathParameters") or {}
        node_id = path_params.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId path parameter is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Get canvas ID from query params
        params = parse_query_params(event)
        canvas_id = params.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId query parameter is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        # Check membership
        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        # Collect all node IDs in subtree (BFS)
        subtree_node_ids = collect_subtree_nodes(canvas_id, node_id)

        if not subtree_node_ids:
            # Node doesn't exist, return success with 0 counts
            return success_response({
                "deletedNodeCount": 0,
                "deletedFileCount": 0,
            })

        # Get all nodes to extract S3 keys
        table = get_nodes_table()
        nodes_to_delete = []
        for nid in subtree_node_ids:
            node = get_node(canvas_id, nid)
            if node:
                nodes_to_delete.append(node)

        # Extract all S3 keys from file references
        s3_keys = extract_file_s3_keys_from_nodes(nodes_to_delete)

        # Delete S3 objects
        deleted_file_count = batch_delete_s3_objects(s3_keys)

        # Delete nodes from DynamoDB
        deleted_node_count = batch_delete_nodes(canvas_id, subtree_node_ids)

        logger.info(
            f"Deleted {deleted_node_count} nodes and {deleted_file_count} files "
            f"for subtree rooted at {node_id} in canvas {canvas_id}"
        )

        return success_response({
            "deletedNodeCount": deleted_node_count,
            "deletedFileCount": deleted_file_count,
        })

    except Exception as e:
        logger.error(f"Error deleting node: {str(e)}", exc_info=True)
        return internal_error_response("Failed to delete node")


def execute_node(event, context):
    """POST /nodes/{nodeId}/execute - Trigger agent execution via gateway."""
    try:
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        path_params = event.get("pathParameters") or {}
        node_id = path_params.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId path parameter is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        canvas_id = body.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        assigned_to = node.get("assignedTo")
        if not assigned_to or assigned_to.get("type") != "agent":
            return error_response(
                code="INVALID_REQUEST",
                message="Node must be assigned to an agent before execution",
            )

        if "approvalMode" in body:
            valid, error_msg = validate_approval_mode(body.get("approvalMode"))
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        gateway_base_url = os.environ.get("GATEWAY_API_BASE_URL", "").strip().rstrip("/")
        if not gateway_base_url:
            return internal_error_response("Gateway API base URL is not configured")

        headers = event.get("headers") or {}
        auth_header = headers.get("authorization") or headers.get("Authorization") or ""
        user_token = auth_header.strip()
        if user_token and not user_token.startswith("Bearer "):
            user_token = "Bearer " + user_token

        payload = {
            "canvasId": canvas_id,
            "nodeId": node_id,
        }
        if user_token:
            payload["userToken"] = user_token
        if body.get("approvalMode"):
            payload["approvalMode"] = body.get("approvalMode")

        gateway_headers = {
            "Content-Type": "application/json",
        }
        shared_secret = os.environ.get("GATEWAY_SHARED_SECRET", "").strip()
        if shared_secret:
            gateway_headers["X-Glassbox-Token"] = shared_secret

        req = request.Request(
            gateway_base_url + "/execute",
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers=gateway_headers,
        )

        try:
            with request.urlopen(req, timeout=30) as response:
                raw_body = response.read().decode("utf-8")
                status = response.status
        except error.HTTPError as exc:
            raw_body = exc.read().decode("utf-8")
            status = exc.code
        except error.URLError as exc:
            logger.error(f"Gateway call failed: {str(exc)}")
            return internal_error_response("Failed to reach gateway")

        if status >= 400:
            return error_response(
                code="GATEWAY_ERROR",
                message="Gateway returned an error",
                details={"status": status, "body": raw_body},
                status_code=502,
            )

        try:
            data = json.loads(raw_body) if raw_body else {"ok": True}
        except ValueError:
            data = {"raw": raw_body}

        return success_response({
            "gatewayResponse": data,
        })

    except Exception as e:
        logger.error(f"Error executing node: {str(e)}", exc_info=True)
        return internal_error_response("Failed to execute node")


def approve_node_action(event, context):
    """POST /nodes/{nodeId}/approve - Resolve an approval request."""
    try:
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        path_params = event.get("pathParameters") or {}
        node_id = path_params.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId path parameter is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        canvas_id = body.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

        approval_id = body.get("approvalId")
        if not approval_id or not isinstance(approval_id, str):
            return error_response(
                code="INVALID_REQUEST",
                message="approvalId is required",
            )

        decision = body.get("decision")
        valid, error_msg = validate_approval_decision(decision)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        reason = body.get("reason")
        if reason is not None and not isinstance(reason, str):
            return error_response(
                code="INVALID_REQUEST",
                message="reason must be a string",
            )

        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        approval_requests = node.get("approvalRequests", [])
        updated_requests = []
        found = False
        now = datetime.utcnow().isoformat() + "Z"

        for request_item in approval_requests:
            if request_item.get("approvalId") == approval_id:
                found = True
                updated_item = dict(request_item)
                updated_item["status"] = decision
                updated_item["resolvedAt"] = now
                updated_item["resolvedBy"] = user_sub
                if reason:
                    updated_item["reason"] = reason
                updated_requests.append(updated_item)
            else:
                updated_requests.append(request_item)

        if not found:
            return error_response(
                code="NOT_FOUND",
                message="Approval request not found",
                status_code=404,
            )

        activity_log = node.get("activityLog", [])
        activity_log.append({
            "logId": str(uuid.uuid4()),
            "type": "approval",
            "message": f"Approval {decision}: {approval_id}",
            "createdAt": now,
            "data": {
                "approvalId": approval_id,
                "decision": decision,
                "reason": reason,
            },
        })

        table = get_nodes_table()
        update_expression = (
            "SET approvalRequests = :approvalRequests, activityLog = :activityLog, "
            "updatedAt = :now, authorSub = :authorSub, GSI1SK = :gsi1sk"
        )
        expression_attribute_values = {
            ":approvalRequests": updated_requests,
            ":activityLog": activity_log,
            ":now": now,
            ":authorSub": user_sub,
            ":gsi1sk": f"UPDATED#{now}#NODE#{node_id}",
        }

        response = table.update_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"NODE#{node_id}",
            },
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_attribute_values,
            ReturnValues="ALL_NEW",
        )

        updated_item = response["Attributes"]
        evidence, evidence_error = normalize_evidence(updated_item.get("evidence"))
        if evidence_error:
            evidence = []

        updated_node = {
            "nodeId": updated_item["nodeId"],
            "canvasId": updated_item["canvasId"],
            "parentNodeId": updated_item["parentNodeId"],
            "title": updated_item["title"],
            "description": updated_item["description"],
            "inputs": updated_item.get("inputs", []),
            "outputs": updated_item.get("outputs", []),
            "evidence": evidence,
            "status": updated_item.get("status") or "draft",
            "approvalMode": updated_item.get("approvalMode"),
            "assignedTo": updated_item.get("assignedTo"),
            "approvalRequests": updated_item.get("approvalRequests", []),
            "activityLog": updated_item.get("activityLog", []),
            "activeTaskId": updated_item.get("activeTaskId"),
            "authorSub": updated_item["authorSub"],
            "createdAt": updated_item["createdAt"],
            "updatedAt": updated_item["updatedAt"],
        }

        return success_response(updated_node)

    except Exception as e:
        logger.error(f"Error approving node action: {str(e)}", exc_info=True)
        return internal_error_response("Failed to approve node action")
