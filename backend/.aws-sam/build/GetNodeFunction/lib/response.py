"""Standardized response formatting for API responses."""

import json
from typing import Any, Dict, Optional


def success_response(data: Any, status_code: int = 200) -> Dict[str, Any]:
    """Create a standardized success response."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"ok": True, "data": data}, default=str),
    }


def error_response(
    code: str,
    message: str,
    details: Optional[Any] = None,
    status_code: int = 400,
) -> Dict[str, Any]:
    """Create a standardized error response."""
    error_obj: Dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error_obj["details"] = details

    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"ok": False, "error": error_obj}, default=str),
    }


def internal_error_response(message: str = "Internal server error") -> Dict[str, Any]:
    """Create a standardized internal error response."""
    return error_response(
        code="INTERNAL_ERROR",
        message=message,
        status_code=500,
    )
