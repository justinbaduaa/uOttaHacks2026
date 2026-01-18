"""Input validation utilities."""

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .response import error_response

# ISO8601 regex pattern
ISO8601_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$"
)


def parse_body(event: Dict) -> Tuple[Optional[Dict], Optional[Dict]]:
    """
    Parse JSON body from event.
    
    Returns:
        (body_dict, None) if successful
        (None, error_response_dict) if parsing fails
    """
    body = event.get("body")
    if not body:
        return None, error_response(
            code="INVALID_REQUEST",
            message="Request body is required",
        )

    try:
        if isinstance(body, str):
            body_dict = json.loads(body)
        else:
            body_dict = body
        return body_dict, None
    except (json.JSONDecodeError, ValueError) as e:
        return None, error_response(
            code="INVALID_REQUEST",
            message=f"Invalid JSON in request body: {str(e)}",
        )


def parse_query_params(event: Dict) -> Dict[str, str]:
    """Parse query string parameters from event."""
    query_params = event.get("queryStringParameters") or {}
    return query_params if isinstance(query_params, dict) else {}


def validate_canvas_id(canvas_id: str) -> Tuple[bool, Optional[str]]:
    """Validate canvas ID format (UUID expected)."""
    if not canvas_id or not isinstance(canvas_id, str):
        return False, "canvasId must be a non-empty string"
    # Basic UUID format check (can be more strict if needed)
    uuid_pattern = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )
    if not uuid_pattern.match(canvas_id):
        return False, "canvasId must be a valid UUID"
    return True, None


def validate_node_id(node_id: str) -> Tuple[bool, Optional[str]]:
    """Validate node ID format (UUID expected)."""
    if not node_id or not isinstance(node_id, str):
        return False, "nodeId must be a non-empty string"
    uuid_pattern = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )
    if not uuid_pattern.match(node_id):
        return False, "nodeId must be a valid UUID"
    return True, None


def validate_iso8601(timestamp: str) -> Tuple[bool, Optional[str]]:
    """Validate ISO8601 timestamp format."""
    if not isinstance(timestamp, str):
        return False, "timestamp must be a string"
    if not ISO8601_PATTERN.match(timestamp):
        return False, "timestamp must be in ISO8601 format"
    try:
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return True, None
    except ValueError:
        return False, "timestamp must be a valid ISO8601 datetime"


def validate_file_slot(slot: str) -> Tuple[bool, Optional[str]]:
    """Validate file slot is either 'inputs' or 'outputs'."""
    if slot not in ["inputs", "outputs"]:
        return False, "slot must be either 'inputs' or 'outputs'"
    return True, None


def validate_file_item(item: Dict) -> Tuple[bool, Optional[str]]:
    """Validate a file item in inputs/outputs array."""
    if not isinstance(item, dict):
        return False, "file item must be an object"
    
    file_type = item.get("type")
    if file_type not in ["text", "link", "file"]:
        return False, "file item type must be one of: text, link, file"
    
    if file_type == "file":
        required_fields = ["fileId", "s3Key", "filename"]
        for field in required_fields:
            if not item.get(field):
                return False, f"file item of type 'file' must have {field}"
    
    return True, None


def validate_inputs_outputs(items: List[Dict]) -> Tuple[bool, Optional[str]]:
    """Validate inputs or outputs array."""
    if not isinstance(items, list):
        return False, "inputs/outputs must be an array"
    
    for item in items:
        valid, error = validate_file_item(item)
        if not valid:
            return False, error
    
    return True, None


def normalize_evidence(evidence: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Normalize and validate evidence payload.
    
    Evidence format:
      {
        "notes": ["text", ...] | "text",
        "files": [file_item, ...]
      }
    """
    if evidence is None:
        return {"notes": [], "files": []}, None

    if not isinstance(evidence, dict):
        return None, "evidence must be an object"

    notes = evidence.get("notes", [])
    files = evidence.get("files", [])

    if isinstance(notes, str):
        notes = [notes]
    if not isinstance(notes, list):
        return None, "evidence.notes must be a string or array of strings"
    for note in notes:
        if not isinstance(note, str):
            return None, "evidence.notes must contain only strings"

    if not isinstance(files, list):
        return None, "evidence.files must be an array"
    for item in files:
        valid, error = validate_file_item(item)
        if not valid:
            return None, f"evidence.files: {error}"

    return {"notes": notes, "files": files}, None
