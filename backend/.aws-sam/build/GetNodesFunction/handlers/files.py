"""File upload/download Lambda handlers."""

import os
import uuid
from datetime import datetime

from lib.auth import require_auth
from lib.dynamodb import get_canvas_table, get_node, get_nodes_table, require_membership
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.s3 import generate_presigned_get_url, generate_presigned_put_url
from lib.validation import (
    parse_body,
    validate_canvas_id,
    validate_file_slot,
    validate_node_id,
    normalize_evidence,
)

logger = get_logger(__name__)


def presign_file(event, context):
    """POST /files/presign - Generate a presigned URL for file upload."""
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

        scope = body.get("scope") or "node"
        if scope not in ["node", "canvas"]:
            return error_response(
                code="INVALID_REQUEST",
                message="scope must be 'node' or 'canvas'",
            )

        slot = body.get("slot")
        if not slot:
            return error_response(
                code="INVALID_REQUEST",
                message="slot is required",
            )

        valid, error_msg = validate_file_slot(slot)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        if scope == "canvas" and slot != "evidence":
            return error_response(
                code="INVALID_REQUEST",
                message="canvas uploads only support slot 'evidence'",
            )

        filename = body.get("filename")
        if not filename or not isinstance(filename, str):
            return error_response(
                code="INVALID_REQUEST",
                message="filename is required and must be a non-empty string",
            )

        content_type = body.get("contentType", "application/octet-stream")

        node_id = body.get("nodeId")
        if scope == "node":
            if not node_id:
                return error_response(
                    code="INVALID_REQUEST",
                    message="nodeId is required",
                )

            valid, error_msg = validate_node_id(node_id)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

            # Verify node exists and belongs to canvas
            node = get_node(canvas_id, node_id)
            if not node:
                return error_response(
                    code="NOT_FOUND",
                    message="Node not found",
                    status_code=404,
                )
        else:
            table = get_canvas_table()
            response = table.get_item(
                Key={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": "META",
                }
            )
            if "Item" not in response:
                return error_response(
                    code="NOT_FOUND",
                    message="Canvas not found",
                    status_code=404,
                )

        # Generate file ID
        file_id = str(uuid.uuid4())

        # Construct S3 key
        if scope == "canvas":
            s3_key = f"canvases/{canvas_id}/evidence/{file_id}/{filename}"
        else:
            s3_key = f"canvases/{canvas_id}/nodes/{node_id}/{file_id}/{filename}"

        # Generate presigned PUT URL
        upload_url = generate_presigned_put_url(s3_key, content_type)
        if not upload_url:
            return internal_error_response("Failed to generate presigned URL")

        logger.info(
            f"Generated presigned URL for file upload: {s3_key} "
            f"(canvas={canvas_id}, scope={scope})"
        )

        return success_response({
            "fileId": file_id,
            "s3Key": s3_key,
            "uploadUrl": upload_url,
            "expiresInSeconds": 3600,  # 1 hour
        })

    except Exception as e:
        logger.error(f"Error generating presigned URL: {str(e)}", exc_info=True)
        return internal_error_response("Failed to generate presigned URL")


def complete_file(event, context):
    """POST /files/complete - Complete file upload by adding file reference to node."""
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

        scope = body.get("scope") or "node"
        if scope not in ["node", "canvas"]:
            return error_response(
                code="INVALID_REQUEST",
                message="scope must be 'node' or 'canvas'",
            )

        slot = body.get("slot")
        if not slot:
            return error_response(
                code="INVALID_REQUEST",
                message="slot is required",
            )

        valid, error_msg = validate_file_slot(slot)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        if scope == "canvas" and slot != "evidence":
            return error_response(
                code="INVALID_REQUEST",
                message="canvas uploads only support slot 'evidence'",
            )

        file_id = body.get("fileId")
        if not file_id:
            return error_response(
                code="INVALID_REQUEST",
                message="fileId is required",
            )

        s3_key = body.get("s3Key")
        if not s3_key:
            return error_response(
                code="INVALID_REQUEST",
                message="s3Key is required",
            )

        filename = body.get("filename")
        if not filename:
            return error_response(
                code="INVALID_REQUEST",
                message="filename is required",
            )

        content_type = body.get("contentType", "application/octet-stream")

        node_id = body.get("nodeId")
        node = None
        if scope == "node":
            if not node_id:
                return error_response(
                    code="INVALID_REQUEST",
                    message="nodeId is required",
                )

            valid, error_msg = validate_node_id(node_id)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

            # Verify node exists and belongs to canvas
            node = get_node(canvas_id, node_id)
            if not node:
                return error_response(
                    code="NOT_FOUND",
                    message="Node not found",
                    status_code=404,
                )
        else:
            table = get_canvas_table()
            response = table.get_item(
                Key={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": "META",
                }
            )
            if "Item" not in response:
                return error_response(
                    code="NOT_FOUND",
                    message="Canvas not found",
                    status_code=404,
                )

        # Create file item
        file_item = {
            "type": "file",
            "fileId": file_id,
            "s3Key": s3_key,
            "filename": filename,
            "contentType": content_type,
            "createdAt": datetime.utcnow().isoformat() + "Z",
        }

        now = datetime.utcnow().isoformat() + "Z"
        if scope == "canvas":
            table = get_canvas_table()
            response = table.get_item(
                Key={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": "META",
                }
            )
            meta_item = response.get("Item")
            if not meta_item:
                return error_response(
                    code="NOT_FOUND",
                    message="Canvas not found",
                    status_code=404,
                )
            evidence, evidence_error = normalize_evidence(meta_item.get("evidence"))
            if evidence_error:
                return error_response(code="INVALID_REQUEST", message=evidence_error)
            evidence_files = evidence.get("files", [])
            evidence_files.append(file_item)
            evidence["files"] = evidence_files

            response = table.update_item(
                Key={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": "META",
                },
                UpdateExpression="SET evidence = :evidence, updatedAt = :now",
                ExpressionAttributeValues={
                    ":evidence": evidence,
                    ":now": now,
                },
                ReturnValues="ALL_NEW",
            )
            updated_item = response.get("Attributes", {})
            updated_evidence, evidence_error = normalize_evidence(updated_item.get("evidence"))
            if evidence_error:
                updated_evidence = evidence

            logger.info(
                f"Completed file upload for canvas {canvas_id}: "
                f"{file_id} added to evidence"
            )

            return success_response({
                "canvasId": canvas_id,
                "evidence": updated_evidence,
                "updatedAt": updated_item.get("updatedAt") or now,
            })

        # Update node with new file reference
        table = get_nodes_table()

        expression_attribute_values = {
            ":now": now,
            ":authorSub": user_sub,
            ":gsi1sk": f"UPDATED#{now}#NODE#{node_id}",
        }

        if slot == "evidence":
            evidence, evidence_error = normalize_evidence(node.get("evidence"))
            if evidence_error:
                return error_response(code="INVALID_REQUEST", message=evidence_error)
            evidence_files = evidence.get("files", [])
            evidence_files.append(file_item)
            evidence["files"] = evidence_files
            update_expression = "SET evidence = :evidence, updatedAt = :now, authorSub = :authorSub, GSI1SK = :gsi1sk"
            expression_attribute_values[":evidence"] = evidence
        else:
            # Get current inputs/outputs list
            current_items = node.get(slot, []).copy()
            current_items.append(file_item)
            update_expression = f"SET {slot} = :items, updatedAt = :now, authorSub = :authorSub, GSI1SK = :gsi1sk"
            expression_attribute_values[":items"] = current_items

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
<<<<<<< HEAD
            evidence = {"notes": [], "files": []}
=======
            evidence = []
>>>>>>> origin/solace-integration

        logger.info(
            f"Completed file upload for node {node_id} in canvas {canvas_id}: "
            f"{file_id} added to {slot}"
        )

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
<<<<<<< HEAD
=======
            "status": updated_item.get("status") or "draft",
            "approvalMode": updated_item.get("approvalMode"),
            "assignedTo": updated_item.get("assignedTo"),
            "approvalRequests": updated_item.get("approvalRequests", []),
            "activityLog": updated_item.get("activityLog", []),
            "activeTaskId": updated_item.get("activeTaskId"),
>>>>>>> origin/solace-integration
            "authorSub": updated_item["authorSub"],
            "createdAt": updated_item["createdAt"],
            "updatedAt": updated_item["updatedAt"],
        }

        return success_response(updated_node)

    except Exception as e:
        logger.error(f"Error completing file upload: {str(e)}", exc_info=True)
        return internal_error_response("Failed to complete file upload")


<<<<<<< HEAD
def download_file(event, context):
    """POST /files/download - Generate a presigned URL for file download."""
    try:
        # Require authentication
=======
def presign_download(event, context):
    """POST /files/presign-download - Generate a presigned URL for file download."""
    try:
>>>>>>> origin/solace-integration
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

<<<<<<< HEAD
        # Parse request body
=======
>>>>>>> origin/solace-integration
        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

<<<<<<< HEAD
        # Validate required fields
=======
>>>>>>> origin/solace-integration
        canvas_id = body.get("canvasId")
        if not canvas_id:
            return error_response(
                code="INVALID_REQUEST",
                message="canvasId is required",
            )

        valid, error_msg = validate_canvas_id(canvas_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

<<<<<<< HEAD
        # Check membership
=======
>>>>>>> origin/solace-integration
        is_member, membership_error = require_membership(canvas_id, user_sub)
        if not is_member:
            return membership_error

<<<<<<< HEAD
        scope = body.get("scope") or "node"
        if scope not in ["node", "canvas"]:
            return error_response(
                code="INVALID_REQUEST",
                message="scope must be 'node' or 'canvas'",
            )

=======
        node_id = body.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

>>>>>>> origin/solace-integration
        file_id = body.get("fileId")
        s3_key = body.get("s3Key")
        if not file_id and not s3_key:
            return error_response(
                code="INVALID_REQUEST",
                message="fileId or s3Key is required",
            )

<<<<<<< HEAD
        candidates = []
        if scope == "node":
            node_id = body.get("nodeId")
            if not node_id:
                return error_response(
                    code="INVALID_REQUEST",
                    message="nodeId is required",
                )

            valid, error_msg = validate_node_id(node_id)
            if not valid:
                return error_response(code="INVALID_REQUEST", message=error_msg)

            # Verify node exists and belongs to canvas
            node = get_node(canvas_id, node_id)
            if not node:
                return error_response(
                    code="NOT_FOUND",
                    message="Node not found",
                    status_code=404,
                )

            candidates.extend(node.get("inputs", []))
            candidates.extend(node.get("outputs", []))
            evidence = node.get("evidence")
            if isinstance(evidence, dict):
                candidates.extend(evidence.get("files", []))
        else:
            table = get_canvas_table()
            response = table.get_item(
                Key={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": "META",
                }
            )
            item = response.get("Item")
            if not item:
                return error_response(
                    code="NOT_FOUND",
                    message="Canvas not found",
                    status_code=404,
                )
            evidence, evidence_error = normalize_evidence(item.get("evidence"))
            if evidence_error:
                evidence = {"notes": [], "files": []}
            candidates.extend(evidence.get("files", []))

        matched = None
        for item in candidates:
            if item.get("type") != "file":
                continue
            if file_id and item.get("fileId") == file_id:
                matched = item
                break
            if s3_key and item.get("s3Key") == s3_key:
                matched = item
                break

        if not matched:
=======
        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        file_item = None
        for slot in ["inputs", "outputs", "evidence"]:
            items = node.get(slot, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if item.get("type") != "file":
                    continue
                if file_id and item.get("fileId") == file_id:
                    file_item = item
                    break
                if s3_key and item.get("s3Key") == s3_key:
                    file_item = item
                    break
            if file_item:
                break

        if not file_item:
>>>>>>> origin/solace-integration
            return error_response(
                code="NOT_FOUND",
                message="File not found on node",
                status_code=404,
            )

<<<<<<< HEAD
        resolved_key = matched.get("s3Key")
        if not resolved_key:
            return internal_error_response("Missing s3Key for file")

        download_url = generate_presigned_get_url(resolved_key)
=======
        s3_key = file_item.get("s3Key")
        if not s3_key:
            return error_response(
                code="INVALID_REQUEST",
                message="File item missing s3Key",
            )

        download_url = generate_presigned_get_url(s3_key)
>>>>>>> origin/solace-integration
        if not download_url:
            return internal_error_response("Failed to generate presigned URL")

        return success_response({
<<<<<<< HEAD
            "fileId": matched.get("fileId"),
            "s3Key": resolved_key,
            "filename": matched.get("filename"),
            "contentType": matched.get("contentType"),
=======
            "fileId": file_item.get("fileId"),
            "s3Key": s3_key,
            "filename": file_item.get("filename"),
            "contentType": file_item.get("contentType", "application/octet-stream"),
>>>>>>> origin/solace-integration
            "downloadUrl": download_url,
            "expiresInSeconds": 3600,
        })

    except Exception as e:
<<<<<<< HEAD
        logger.error(f"Error generating download URL: {str(e)}", exc_info=True)
        return internal_error_response("Failed to generate download URL")
=======
        logger.error(f"Error generating presigned download URL: {str(e)}", exc_info=True)
        return internal_error_response("Failed to generate presigned URL")
>>>>>>> origin/solace-integration
