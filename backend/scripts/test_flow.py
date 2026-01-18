import argparse
import json
import os
from datetime import datetime

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a minimal end-to-end test flow.")
    parser.add_argument("--canvas-name", default=os.getenv("CANVAS_NAME", ""), help="Canvas name")
    parser.add_argument("--node-title", default=os.getenv("NODE_TITLE", ""), help="Node title")
    parser.add_argument("--agent-id", default=os.getenv("AGENT_ID", "GlassBoxWorker"), help="Agent ID")
    parser.add_argument("--approval-mode", default=os.getenv("APPROVAL_MODE", "approve_nodes"), help="Approval mode")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_name = args.canvas_name.strip() if args.canvas_name else ""
    if not canvas_name:
        canvas_name = "Test Canvas " + datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    node_title = args.node_title.strip() if args.node_title else ""
    if not node_title:
        node_title = "RFI: Vendor X Security Review"

    print_title("Create Canvas")
    response = request_json(
        method="POST",
        path="/canvases",
        body={"name": canvas_name},
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )

    canvas_id = _extract_canvas_id(response)
    if not canvas_id:
        raise SystemExit("Failed to create canvas.")

    print_title("Create Node")
    response = request_json(
        method="POST",
        path="/nodes",
        body={
            "canvasId": canvas_id,
            "title": node_title,
            "description": "Summarize Vendor X security posture.",
            "inputs": [
                {
                    "type": "text",
                    "text": "Summarize Vendor X security posture and list any gaps.",
                }
            ],
            "status": "draft",
        },
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )

    node_id = _extract_node_id(response)
    if not node_id:
        raise SystemExit("Failed to create node.")

    print_title("Assign Agent + Ready")
    request_json(
        method="PATCH",
        path="/nodes/" + node_id,
        body={
            "canvasId": canvas_id,
            "assignedTo": {"type": "agent", "id": args.agent_id},
            "approvalMode": args.approval_mode,
            "status": "ready",
        },
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )

    print_title("Execute")
    request_json(
        method="POST",
        path="/nodes/" + node_id + "/execute",
        body={"canvasId": canvas_id},
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )

    print_title("Next Steps")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    log("Stream logs:")
    log(
        "curl -N \"http://127.0.0.1:8001/stream?canvasId="
        + canvas_id
        + "&nodeId="
        + node_id
        + "\" -H \"Authorization: Bearer <token>\""
    )


def _extract_canvas_id(response: dict) -> str:
    body = response.get("raw_body", "")
    if not body:
        return ""
    try:
        parsed = json.loads(body)
    except ValueError:
        return ""
    data = parsed.get("data", {})
    if not isinstance(data, dict):
        return ""
    return data.get("canvasId", "")


def _extract_node_id(response: dict) -> str:
    body = response.get("raw_body", "")
    if not body:
        return ""
    try:
        parsed = json.loads(body)
    except ValueError:
        return ""
    data = parsed.get("data", {})
    if not isinstance(data, dict):
        return ""
    return data.get("nodeId", "")


if __name__ == "__main__":
    main()
