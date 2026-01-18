import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Get nodes for a canvas.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--parent-node-id", default=os.getenv("PARENT_NODE_ID", ""), help="Parent node ID")
    parser.add_argument("--updated-since", default=os.getenv("UPDATED_SINCE", ""), help="ISO8601 timestamp")
    parser.add_argument("--include-all", action="store_true", help="Fetch all nodes in the canvas")
    parser.add_argument("--include-deleted", action="store_true", help="Include soft-deleted nodes")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    print_title("Get Nodes")
    log("Canvas ID: " + canvas_id)
    if args.parent_node_id:
        log("Parent node ID: " + args.parent_node_id)
    if args.updated_since:
        log("Updated since: " + args.updated_since)
    if args.include_all:
        log("Include all nodes: true")
    if args.include_deleted:
        log("Include deleted nodes: true")

    query = {
        "canvasId": canvas_id,
        "parentNodeId": args.parent_node_id or None,
        "updatedSince": args.updated_since or None,
    }
    if args.include_all:
        query["includeAll"] = "true"
    if args.include_deleted:
        query["includeDeleted"] = "true"

    request_json(
        method="GET",
        path="/nodes",
        query=query,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
