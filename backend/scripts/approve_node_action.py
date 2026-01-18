import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Approve or reject a node action.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--approval-id", default=os.getenv("APPROVAL_ID", ""), help="Approval request ID")
    parser.add_argument("--decision", default=os.getenv("APPROVAL_DECISION", ""), help="approved or rejected")
    parser.add_argument("--reason", default=os.getenv("APPROVAL_REASON", ""), help="Optional reason")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    node_id = args.node_id.strip() if args.node_id else ""
    if not node_id:
        raise SystemExit("Node ID is required. Set NODE_ID or pass --node-id.")

    approval_id = args.approval_id.strip() if args.approval_id else ""
    if not approval_id:
        raise SystemExit("Approval ID is required. Set APPROVAL_ID or pass --approval-id.")

    decision = args.decision.strip().lower() if args.decision else ""
    if decision not in ["approved", "rejected"]:
        raise SystemExit("Decision must be approved or rejected.")

    print_title("Approve Node Action")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    log("Approval ID: " + approval_id)
    log("Decision: " + decision)

    body = {
        "canvasId": canvas_id,
        "approvalId": approval_id,
        "decision": decision,
    }
    if args.reason:
        body["reason"] = args.reason

    request_json(
        method="POST",
        path="/nodes/" + node_id + "/approve",
        body=body,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
