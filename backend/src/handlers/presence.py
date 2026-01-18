"""Presence-related Lambda handlers."""

from datetime import datetime

from lib.auth import require_auth
from lib.dynamodb import get_canvas_table, require_membership
from lib.logging import get_logger
from lib.response import error_response, internal_error_response, success_response
from lib.validation import parse_body, validate_canvas_id

logger = get_logger(__name__)


def leave_presence(event, context):
    """POST /presence/leave - Remove the user's presence from a canvas."""
    try:
        # Require authentication
        user_sub, auth_error = require_auth(event)
        if auth_error:
            return auth_error

        # Parse request body
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

        table = get_canvas_table()
        table.delete_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"PRESENCE#{user_sub}",
            }
        )

        logger.info(f"User {user_sub} left presence for canvas {canvas_id}")
        return success_response({
            "canvasId": canvas_id,
            "userId": user_sub,
            "leftAt": datetime.utcnow().isoformat() + "Z",
        })

    except Exception as e:
        logger.error(f"Error leaving presence: {str(e)}", exc_info=True)
        return internal_error_response("Failed to leave presence")
