"""DynamoDB helper utilities."""

import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Attr, Key

from .response import error_response, internal_error_response
from .validation import normalize_evidence

dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
canvas_table_name = os.environ["CANVAS_TABLE"]
nodes_table_name = os.environ["NODES_TABLE"]


def get_canvas_table():
    """Get CanvasTable DynamoDB table resource."""
    return dynamodb.Table(canvas_table_name)


def get_nodes_table():
    """Get NodesTable DynamoDB table resource."""
    return dynamodb.Table(nodes_table_name)


def get_canvas_meta(canvas_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve canvas metadata from CanvasTable."""
    table = get_canvas_table()
    try:
        response = table.get_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": "META",
            }
        )
        item = response.get("Item")
        if not item:
            return None
        
        # Transform DynamoDB item to API format
        return {
            "canvasId": canvas_id,
            "ownerSub": item.get("ownerSub"),
            "name": item.get("name"),
            "joinCode": item.get("joinCode"),
            "createdAt": item.get("createdAt"),
        }
    except Exception as e:
        return None


def check_membership(canvas_id: str, user_sub: str) -> bool:
    """Check if user is a member of the canvas."""
    table = get_canvas_table()
    try:
        response = table.get_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"MEMBER#{user_sub}",
            }
        )
        return "Item" in response
    except Exception:
        return False


def require_membership(canvas_id: str, user_sub: str) -> tuple[bool, Optional[Dict]]:
    """
    Require user to be a member of the canvas.
    
    Returns:
        (True, None) if member
        (False, error_response_dict) if not member
    """
    is_member = check_membership(canvas_id, user_sub)
    if not is_member:
        return False, error_response(
            code="FORBIDDEN",
            message="You are not a member of this canvas",
            status_code=403,
        )
    return True, None


def list_canvases_for_user(user_sub: str) -> List[Dict[str, Any]]:
    """List all canvases for a user using USER#{userSub} PK pattern."""
    table = get_canvas_table()
    try:
        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"USER#{user_sub}"),
        )
        items = response.get("Items", [])
        
        canvases = []
        for item in items:
            join_code = item.get("joinCode")
            owner_sub = item.get("ownerSub")
            if not join_code and owner_sub and owner_sub == user_sub:
                meta = get_canvas_meta(item.get("SK", "").replace("CANVAS#", ""))
                if meta and meta.get("joinCode"):
                    join_code = meta.get("joinCode")
            canvases.append({
                "canvasId": item.get("SK").replace("CANVAS#", ""),
                "name": item.get("name"),
                "joinedAt": item.get("joinedAt"),
                "ownerSub": owner_sub,  # May be None if not owner
                "joinCode": join_code,
            })
        
        return canvases
    except Exception as e:
        return []


def upsert_canvas_presence(
    canvas_id: str,
    user_sub: str,
    display_name: Optional[str] = None,
    initial: Optional[str] = None,
    last_active_at: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Upsert a presence record for a user in a canvas."""
    table = get_canvas_table()
    try:
        now = last_active_at or datetime.utcnow().isoformat() + "Z"
        item = {
            "PK": f"CANVAS#{canvas_id}",
            "SK": f"PRESENCE#{user_sub}",
            "userSub": user_sub,
            "displayName": display_name,
            "initial": initial,
            "lastActiveAt": now,
        }
        table.put_item(Item=item)
        return item
    except Exception:
        return None


def list_canvas_presence(
    canvas_id: str,
    active_since: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List active presence records for a canvas."""
    table = get_canvas_table()
    try:
        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"CANVAS#{canvas_id}")
            & Key("SK").begins_with("PRESENCE#"),
        )
        items = response.get("Items", [])
        active_users = []
        for item in items:
            last_active_at = item.get("lastActiveAt") or ""
            if active_since and last_active_at and last_active_at < active_since:
                continue
            active_users.append({
                "userId": item.get("userSub") or item.get("SK", "").replace("PRESENCE#", ""),
                "displayName": item.get("displayName"),
                "initial": item.get("initial"),
                "lastActiveAt": last_active_at,
            })
        return active_users
    except Exception:
        return []


def find_canvas_by_join_code(join_code: str) -> Optional[Dict[str, Any]]:
    """
    Find canvas by join code.
    
    Note: This requires a scan operation. For production, consider adding a GSI
    on joinCode, but for MVP we'll scan with a filter.
    """
    table = get_canvas_table()
    try:
        response = table.scan(
            FilterExpression=Attr("SK").eq("META") & Attr("joinCode").eq(join_code),
        )
        items = response.get("Items", [])
        if not items:
            return None
        
        # Get the first match and extract canvasId from PK
        item = items[0]
        canvas_id = item["PK"].replace("CANVAS#", "")
        return {
            "canvasId": canvas_id,
            "ownerSub": item.get("ownerSub"),
            "name": item.get("name"),
            "joinCode": item.get("joinCode"),
            "createdAt": item.get("createdAt"),
        }
    except Exception:
        return None


def query_nodes_by_parent(
    canvas_id: str,
    parent_node_id: str,
    updated_since: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Query nodes by parent using GSI1."""
    table = get_nodes_table()
    try:
        gsi1pk = f"CANVAS#{canvas_id}#PARENT#{parent_node_id}"
        
        if updated_since:
            # Query with updatedSince filter using sort key prefix
            gsi1sk_prefix = f"UPDATED#{updated_since}"
            response = table.query(
                IndexName="GSI1",
                KeyConditionExpression=Key("GSI1PK").eq(gsi1pk) & Key("GSI1SK").gt(gsi1sk_prefix),
            )
        else:
            # Query all children
            response = table.query(
                IndexName="GSI1",
                KeyConditionExpression=Key("GSI1PK").eq(gsi1pk),
            )
        
        items = response.get("Items", [])
        nodes = []
        for item in items:
            nodes.append(_transform_node_item(item))
        
        return nodes
    except Exception as e:
        return []


def query_nodes_by_canvas(
    canvas_id: str,
    updated_since: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Query all nodes in a canvas, optionally filtering by updatedSince."""
    table = get_nodes_table()
    try:
        query_params: Dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(f"CANVAS#{canvas_id}") & Key("SK").begins_with("NODE#"),
        }
        if updated_since:
            query_params["FilterExpression"] = Attr("updatedAt").gt(updated_since)

        response = table.query(**query_params)
        items = response.get("Items", [])
        nodes = []
        for item in items:
            nodes.append(_transform_node_item(item))
        return nodes
    except Exception:
        return []


def get_node(canvas_id: str, node_id: str) -> Optional[Dict[str, Any]]:
    """Get a single node by canvasId and nodeId."""
    table = get_nodes_table()
    try:
        response = table.get_item(
            Key={
                "PK": f"CANVAS#{canvas_id}",
                "SK": f"NODE#{node_id}",
            }
        )
        item = response.get("Item")
        if not item:
            return None
        return _transform_node_item(item)
    except Exception:
        return None


def collect_subtree_nodes(canvas_id: str, root_node_id: str) -> List[str]:
    """
    Collect all node IDs in the subtree rooted at root_node_id using BFS.
    
    Returns list of node IDs including the root.
    """
    node_ids = []
    queue = [root_node_id]
    
    while queue:
        current_parent_id = queue.pop(0)
        if current_parent_id not in node_ids:
            node_ids.append(current_parent_id)
        
        # Query children of current parent
        children = query_nodes_by_parent(canvas_id, current_parent_id)
        for child in children:
            child_id = child["nodeId"]
            if child_id not in node_ids:
                queue.append(child_id)
    
    return node_ids


def _transform_node_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Transform DynamoDB node item to API format."""
    evidence, evidence_error = normalize_evidence(item.get("evidence"))
    if evidence_error:
        evidence = {"notes": [], "files": []}
    position_x = item.get("x")
    position_y = item.get("y")
    return {
        "nodeId": item.get("nodeId"),
        "canvasId": item.get("canvasId"),
        "parentNodeId": item.get("parentNodeId"),
        "title": item.get("title"),
        "description": item.get("description"),
        "inputs": item.get("inputs", []),
        "outputs": item.get("outputs", []),
        "evidence": evidence,
        "authorSub": item.get("authorSub"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
        "x": float(position_x) if position_x is not None else None,
        "y": float(position_y) if position_y is not None else None,
    }


def batch_delete_nodes(canvas_id: str, node_ids: List[str]) -> int:
    """
    Delete multiple nodes using batch operations.
    DynamoDB BatchWriteItem can handle up to 25 items per request.
    """
    table = get_nodes_table()
    deleted_count = 0
    
    # Process in batches of 25
    for i in range(0, len(node_ids), 25):
        batch = node_ids[i:i + 25]
        delete_requests = [
            {
                "DeleteRequest": {
                    "Key": {
                        "PK": f"CANVAS#{canvas_id}",
                        "SK": f"NODE#{node_id}",
                    }
                }
            }
            for node_id in batch
        ]
        
        try:
            with table.batch_writer() as writer:
                for node_id in batch:
                    writer.delete_item(
                        Key={
                            "PK": f"CANVAS#{canvas_id}",
                            "SK": f"NODE#{node_id}",
                        }
                    )
            deleted_count += len(batch)
        except Exception:
            # Continue even if some fail
            pass
    
    return deleted_count
