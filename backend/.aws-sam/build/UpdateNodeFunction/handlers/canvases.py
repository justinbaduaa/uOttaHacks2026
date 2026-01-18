"""Canvas-related Lambda handlers."""

import random
import string
import uuid
from datetime import datetime

from lib.auth import require_auth
from lib.dynamodb import (
    find_canvas_by_join_code,
    get_canvas_table,
    list_canvases_for_user,
)
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.validation import parse_body, validate_canvas_id

logger = get_logger(__name__)


def generate_join_code(length: int = 8) -> str:
    """Generate a human-friendly join code (uppercase letters + digits)."""
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choice(chars) for _ in range(length))


def create_canvas(event, context):
    """POST /canvases - Create a new canvas."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Parse request body
        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        # Validate input
        name = body.get("name")
        if not name or not isinstance(name, str):
            return error_response(
                code="INVALID_REQUEST",
                message="name is required and must be a non-empty string",
            )

        # Generate canvas ID and join code
        canvas_id = str(uuid.uuid4())
        join_code = generate_join_code()

        # Get current timestamp
        now = datetime.utcnow().isoformat() + "Z"

        # Write to DynamoDB
        table = get_canvas_table()

        # Write canvas metadata
        table.put_item(
            Item={
                "PK": f"CANVAS#{canvas_id}",
                "SK": "META",
                "ownerSub": user_sub,
                "name": name,
                "joinCode": join_code,
                "createdAt": now,
            }
        )

        # Write membership record for owner (CANVAS#{canvasId} / MEMBER#{userSub})
        table.put_item(
            Item={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"MEMBER#{user_sub}",
                "joinedAt": now,
            }
        )

        # Write user listing record (USER#{userSub} / CANVAS#{canvasId})
        table.put_item(
            Item={
                "PK": f"USER#{user_sub}",
                "SK": f"CANVAS#{canvas_id}",
                "name": name,
                "joinedAt": now,
                "ownerSub": user_sub,
                "joinCode": join_code,
            }
        )

        logger.info(f"Created canvas {canvas_id} for user {user_sub}")

        return success_response({
            "canvasId": canvas_id,
            "joinCode": join_code,
            "name": name,
        })

    except Exception as e:
        logger.error(f"Error creating canvas: {str(e)}", exc_info=True)
        return internal_error_response("Failed to create canvas")


def join_canvas(event, context):
    """POST /canvases/join - Join a canvas using join code."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Parse request body
        body, parse_error = parse_body(event)
        if parse_error:
            return parse_error

        # Validate input
        join_code = body.get("joinCode")
        if not join_code or not isinstance(join_code, str):
            return error_response(
                code="INVALID_REQUEST",
                message="joinCode is required and must be a non-empty string",
            )

        # Find canvas by join code
        canvas = find_canvas_by_join_code(join_code)
        if not canvas:
            return error_response(
                code="NOT_FOUND",
                message="Canvas not found for the provided join code",
                status_code=404,
            )

        canvas_id = canvas["canvasId"]

        # Check if already a member
        table = get_canvas_table()
        existing_membership = table.get_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"MEMBER#{user_sub}",
            }
        )

        now = datetime.utcnow().isoformat() + "Z"

        # Add membership if not already a member
        if "Item" not in existing_membership:
            # Add CANVAS#{canvasId} / MEMBER#{userSub} record
            table.put_item(
                Item={
                    "PK": f"CANVAS#{canvas_id}",
                    "SK": f"MEMBER#{user_sub}",
                    "joinedAt": now,
                }
            )

            # Add USER#{userSub} / CANVAS#{canvasId} record for listing
            table.put_item(
                Item={
                    "PK": f"USER#{user_sub}",
                    "SK": f"CANVAS#{canvas_id}",
                    "name": canvas["name"],
                    "joinedAt": now,
                    "ownerSub": canvas.get("ownerSub"),
                }
            )

            logger.info(f"User {user_sub} joined canvas {canvas_id}")

        return success_response({
            "canvasId": canvas_id,
            "name": canvas["name"],
        })

    except Exception as e:
        logger.error(f"Error joining canvas: {str(e)}", exc_info=True)
        return internal_error_response("Failed to join canvas")


def list_canvases(event, context):
    """GET /canvases - List all canvases for the current user."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # List canvases for user
        canvases = list_canvases_for_user(user_sub)

        logger.info(f"Listed {len(canvases)} canvases for user {user_sub}")

        return success_response(canvases)

    except Exception as e:
        logger.error(f"Error listing canvases: {str(e)}", exc_info=True)
        return internal_error_response("Failed to list canvases")
