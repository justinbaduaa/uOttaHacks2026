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
    """Validate file slot is either 'inputs', 'outputs', or 'evidence'."""
    if slot not in ["inputs", "outputs", "evidence"]:
        return False, "slot must be one of: inputs, outputs, evidence"
    return True, None


def validate_io_item(item: Dict) -> Tuple[bool, Optional[str]]:
    """Validate an item in inputs/outputs/evidence arrays."""
    if not isinstance(item, dict):
        return False, "item must be an object"
    
    item_type = item.get("type")
    if item_type not in ["text", "link", "file", "node"]:
        return False, "item type must be one of: text, link, file, node"
    
    if item_type == "file":
        required_fields = ["fileId", "s3Key", "filename"]
        for field in required_fields:
            if not item.get(field):
                return False, f"file item of type 'file' must have {field}"
    elif item_type == "text":
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            return False, "text item must have non-empty text"
    elif item_type == "link":
        url = item.get("url")
        if not isinstance(url, str) or not url.strip():
            return False, "link item must have non-empty url"
    elif item_type == "node":
        node_id = item.get("nodeId")
        if not isinstance(node_id, str) or not node_id.strip():
            return False, "node item must have nodeId"
        valid, error = validate_node_id(node_id)
        if not valid:
            return False, error
        include = item.get("include")
        if include is not None and include not in ["outputs", "evidence", "all"]:
            return False, "node include must be one of: outputs, evidence, all"
    
    return True, None


def validate_inputs_outputs(items: List[Dict]) -> Tuple[bool, Optional[str]]:
    """Validate inputs or outputs array."""
    if not isinstance(items, list):
        return False, "inputs/outputs must be an array"
    
    for item in items:
        valid, error = validate_io_item(item)
        if not valid:
            return False, error
    
    return True, None


<<<<<<< HEAD
def normalize_evidence(evidence: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
=======
def validate_node_status(status: str) -> Tuple[bool, Optional[str]]:
    """Validate node status."""
    allowed = ["draft", "ready", "in_progress", "blocked", "completed", "failed"]
    if status not in allowed:
        return False, f"status must be one of: {', '.join(allowed)}"
    return True, None


def validate_approval_mode(mode: str) -> Tuple[bool, Optional[str]]:
    """Validate approval mode."""
    allowed = ["auto", "approve_nodes", "approve_all"]
    if mode not in allowed:
        return False, f"approvalMode must be one of: {', '.join(allowed)}"
    return True, None


def validate_assigned_to(assigned_to: Any) -> Tuple[bool, Optional[str]]:
    """Validate assignedTo payload."""
    if not isinstance(assigned_to, dict):
        return False, "assignedTo must be an object"
    assignee_type = assigned_to.get("type")
    if assignee_type not in ["human", "agent"]:
        return False, "assignedTo.type must be either 'human' or 'agent'"
    assignee_id = assigned_to.get("id")
    if not isinstance(assignee_id, str) or not assignee_id.strip():
        return False, "assignedTo.id must be a non-empty string"
    return True, None


def validate_activity_log(entries: Any) -> Tuple[bool, Optional[str]]:
    """Validate activity log entries (list of dicts)."""
    if entries is None:
        return True, None
    if not isinstance(entries, list):
        return False, "activityLog must be an array"
    for entry in entries:
        if not isinstance(entry, dict):
            return False, "activityLog entries must be objects"
        entry_type = entry.get("type")
        if entry_type is not None and not isinstance(entry_type, str):
            return False, "activityLog.type must be a string"
        message = entry.get("message")
        if message is not None and not isinstance(message, str):
            return False, "activityLog.message must be a string"
    return True, None


def validate_approval_requests(requests: Any) -> Tuple[bool, Optional[str]]:
    """Validate approvalRequests payload."""
    if requests is None:
        return True, None
    if not isinstance(requests, list):
        return False, "approvalRequests must be an array"
    allowed_statuses = ["pending", "approved", "rejected", "applied"]
    for request_item in requests:
        if not isinstance(request_item, dict):
            return False, "approvalRequests entries must be objects"
        approval_id = request_item.get("approvalId")
        if approval_id is not None and not isinstance(approval_id, str):
            return False, "approvalRequests.approvalId must be a string"
        status = request_item.get("status")
        if status is not None and status not in allowed_statuses:
            return False, "approvalRequests.status must be one of: pending, approved, rejected, applied"
    return True, None


def validate_approval_decision(decision: Any) -> Tuple[bool, Optional[str]]:
    """Validate approval decision payload."""
    if not isinstance(decision, str):
        return False, "decision must be a string"
    if decision not in ["approved", "rejected"]:
        return False, "decision must be one of: approved, rejected"
    return True, None


def normalize_evidence(evidence: Any) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
>>>>>>> origin/solace-integration
    """
    Normalize and validate evidence payload.
    
    Evidence format:
<<<<<<< HEAD
      {
        "notes": ["text", ...] | "text",
        "files": [file_item, ...]
      }
    """
    if evidence is None:
        return {"notes": [], "files": []}, None

    if not isinstance(evidence, dict):
        return None, "evidence must be an object"
=======
      [
        { "type": "text", "text": "..." },
        { "type": "file", "fileId": "...", "s3Key": "...", "filename": "..." }
      ]
    """
    if evidence is None:
        return [], None

    if isinstance(evidence, list):
        for item in evidence:
            valid, error = validate_io_item(item)
            if not valid:
                return None, f"evidence: {error}"
        return evidence, None

    if not isinstance(evidence, dict):
        return None, "evidence must be an array of items"
>>>>>>> origin/solace-integration

    notes = evidence.get("notes", [])
    files = evidence.get("files", [])

    if isinstance(notes, str):
        notes = [notes]
    if not isinstance(notes, list):
<<<<<<< HEAD
        return None, "evidence.notes must be a string or array"
    normalized_notes = []
    for idx, note in enumerate(notes):
        if isinstance(note, str):
            normalized_notes.append({
                "noteId": f"note-{idx}",
                "text": note,
                "createdAt": None,
            })
            continue
        if not isinstance(note, dict):
            return None, "evidence.notes items must be strings or objects"
        text = note.get("text") or note.get("content")
        if not text or not isinstance(text, str):
            return None, "evidence.notes items must include text"
        note_id = note.get("noteId") or note.get("id") or f"note-{idx}"
        if note_id and not isinstance(note_id, str):
            return None, "evidence.notes noteId must be a string"
        created_at = note.get("createdAt") or note.get("timestamp")
        if created_at:
            valid, error_msg = validate_iso8601(created_at)
            if not valid:
                return None, error_msg
        normalized_notes.append({
            "noteId": note_id,
            "text": text,
            "createdAt": created_at,
        })

    if not isinstance(files, list):
        return None, "evidence.files must be an array"
    for item in files:
        valid, error = validate_file_item(item)
        if not valid:
            return None, f"evidence.files: {error}"

    return {"notes": normalized_notes, "files": files}, None
=======
        return None, "evidence.notes must be a string or array of strings"
    for note in notes:
        if not isinstance(note, str):
            return None, "evidence.notes must contain only strings"

    if not isinstance(files, list):
        return None, "evidence.files must be an array"

    normalized: List[Dict[str, Any]] = []
    for note in notes:
        normalized.append({"type": "text", "text": note})
    for item in files:
        valid, error = validate_io_item(item)
        if not valid:
            return None, f"evidence.files: {error}"
        normalized.append(item)

    return normalized, None
>>>>>>> origin/solace-integration
