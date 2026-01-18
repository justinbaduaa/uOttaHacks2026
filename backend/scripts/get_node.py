import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Get a node by ID.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    node_id = args.node_id.strip() if args.node_id else ""
    if not node_id:
        raise SystemExit("Node ID is required. Set NODE_ID or pass --node-id.")

    print_title("Get Node")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)

    request_json(
        method="GET",
        path="/nodes/" + node_id,
        query={"canvasId": canvas_id},
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
