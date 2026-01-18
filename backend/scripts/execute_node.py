import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute a node via the gateway.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--approval-mode", default=os.getenv("APPROVAL_MODE", ""), help="Optional approval mode")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    node_id = args.node_id.strip() if args.node_id else ""
    if not node_id:
        raise SystemExit("Node ID is required. Set NODE_ID or pass --node-id.")

    print_title("Execute Node")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    if args.approval_mode:
        log("Approval Mode: " + args.approval_mode)

    body = {
        "canvasId": canvas_id,
    }
    if args.approval_mode:
        body["approvalMode"] = args.approval_mode

    request_json(
        method="POST",
        path="/nodes/" + node_id + "/execute",
        body=body,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
