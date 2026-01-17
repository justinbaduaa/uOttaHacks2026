"""Authentication and authorization utilities."""

import os
from typing import Dict, Optional

from .response import error_response


def extract_user_sub(event: Dict) -> Optional[str]:
    """
    Extract user sub (Cognito user ID) from API Gateway event.
    
    For HTTP API with JWT authorizer, the claims are in event['requestContext']['authorizer']['jwt']['claims']
    """
    try:
        request_context = event.get("requestContext", {})
        authorizer = request_context.get("authorizer", {})
        jwt = authorizer.get("jwt", {})
        claims = jwt.get("claims", {})
        user_sub = claims.get("sub")
        return user_sub
    except (KeyError, AttributeError):
        return None


def require_auth(event: Dict) -> tuple:
    """
    Require authentication and return user sub.
    
    Returns:
        (user_sub, None) if authenticated
        (None, error_response_dict) if not authenticated
    """
    user_sub = extract_user_sub(event)
    if not user_sub:
        return None, error_response(
            code="UNAUTHORIZED",
            message="Authentication required",
            status_code=401,
        )
    return user_sub, None
