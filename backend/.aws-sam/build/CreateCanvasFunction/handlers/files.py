"""File upload/download Lambda handlers."""

import os
import uuid
from datetime import datetime

from lib.auth import require_auth
from lib.dynamodb import get_node, get_nodes_table, require_membership
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.s3 import generate_presigned_put_url
from lib.validation import (
    parse_body,
    validate_canvas_id,
    validate_file_slot,
    validate_node_id,
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

        node_id = body.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        slot = body.get("slot")
        if not slot:
            return error_response(
                code="INVALID_REQUEST",
                message="slot is required",
            )

        valid, error_msg = validate_file_slot(slot)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        filename = body.get("filename")
        if not filename or not isinstance(filename, str):
            return error_response(
                code="INVALID_REQUEST",
                message="filename is required and must be a non-empty string",
            )

        content_type = body.get("contentType", "application/octet-stream")

        # Verify node exists and belongs to canvas
        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        # Generate file ID
        file_id = str(uuid.uuid4())

        # Construct S3 key: canvases/{canvasId}/nodes/{nodeId}/{fileId}/{filename}
        s3_key = f"canvases/{canvas_id}/nodes/{node_id}/{file_id}/{filename}"

        # Generate presigned PUT URL
        upload_url = generate_presigned_put_url(s3_key, content_type)
        if not upload_url:
            return internal_error_response("Failed to generate presigned URL")

        logger.info(
            f"Generated presigned URL for file upload: {s3_key} "
            f"(canvas={canvas_id}, node={node_id})"
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

        node_id = body.get("nodeId")
        if not node_id:
            return error_response(
                code="INVALID_REQUEST",
                message="nodeId is required",
            )

        valid, error_msg = validate_node_id(node_id)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

        slot = body.get("slot")
        if not slot:
            return error_response(
                code="INVALID_REQUEST",
                message="slot is required",
            )

        valid, error_msg = validate_file_slot(slot)
        if not valid:
            return error_response(code="INVALID_REQUEST", message=error_msg)

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

        # Verify node exists and belongs to canvas
        node = get_node(canvas_id, node_id)
        if not node:
            return error_response(
                code="NOT_FOUND",
                message="Node not found",
                status_code=404,
            )

        # Get current inputs/outputs list
        current_items = node.get(slot, []).copy()

        # Create file item
        file_item = {
            "type": "file",
            "fileId": file_id,
            "s3Key": s3_key,
            "filename": filename,
            "contentType": content_type,
        }

        # Append to the appropriate list
        current_items.append(file_item)

        # Update node with new file reference
        now = datetime.utcnow().isoformat() + "Z"
        table = get_nodes_table()

        update_expression = f"SET {slot} = :items, updatedAt = :now, authorSub = :authorSub, GSI1SK = :gsi1sk"
        expression_attribute_values = {
            ":items": current_items,
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
            "authorSub": updated_item["authorSub"],
            "createdAt": updated_item["createdAt"],
            "updatedAt": updated_item["updatedAt"],
        }

        return success_response(updated_node)

    except Exception as e:
        logger.error(f"Error completing file upload: {str(e)}", exc_info=True)
        return internal_error_response("Failed to complete file upload")
