"""Node-related Lambda handlers."""

import uuid
from datetime import datetime
from typing import Dict, List

from lib.auth import require_auth
from lib.dynamodb import (
    batch_delete_nodes,
    collect_subtree_nodes,
    get_node,
    get_nodes_table,
    query_nodes_by_parent,
    require_membership,
)
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.s3 import batch_delete_s3_objects, extract_file_s3_keys_from_nodes
from lib.validation import (
    parse_body,
    parse_query_params,
    validate_approval_mode,
    validate_assigned_to,
    validate_canvas_id,
    validate_inputs_outputs,
    validate_iso8601,
    validate_node_status,
    validate_node_id,
    normalize_evidence,
)

logger = get_logger(__name__)


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

        # Get parent node ID (default to ROOT)
        parent_node_id = params.get("parentNodeId", "ROOT")

        # Get updatedSince if provided
        updated_since = params.get("updatedSince")
        if updated_since:
            valid, error_msg = validate_iso8601(updated_since)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

        # Query nodes
        nodes = query_nodes_by_parent(canvas_id, parent_node_id, updated_since)

        logger.info(
            f"Retrieved {len(nodes)} nodes for canvas {canvas_id}, parent {parent_node_id}"
        )

        return success_response(nodes)

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

        valid, error_msg = validate_node_status(status)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        if status == "completed" and assigned_to and assigned_to.get("type") == "agent":
            if not normalized_evidence:
                return error_response(
                    code="INVALID_REQUEST",
                    message="evidence is required before marking an agent-assigned node completed",
                )

        # Generate node ID
        node_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"

        # Create node item
        table = get_nodes_table()
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
            "authorSub": user_sub,
            "createdAt": now,
            "updatedAt": now,
        }
        if approval_mode is not None:
            item["approvalMode"] = approval_mode
        if assigned_to is not None:
            item["assignedTo"] = assigned_to

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
            "authorSub": user_sub,
            "createdAt": now,
            "updatedAt": now,
        }

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
            "authorSub": updated_item["authorSub"],
            "createdAt": updated_item["createdAt"],
            "updatedAt": updated_item["updatedAt"],
        }

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
