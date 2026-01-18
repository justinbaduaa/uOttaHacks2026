import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Request a presigned file upload URL.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--slot", default=os.getenv("FILE_SLOT", ""), help="inputs, outputs, or evidence")
    parser.add_argument("--filename", default=os.getenv("FILENAME", ""), help="Filename")
    parser.add_argument("--content-type", default=os.getenv("CONTENT_TYPE", ""), help="Content type")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    node_id = args.node_id.strip() if args.node_id else ""
    if not node_id:
        raise SystemExit("Node ID is required. Set NODE_ID or pass --node-id.")

    slot = args.slot.strip() if args.slot else ""
    if not slot:
        raise SystemExit("Slot is required. Set FILE_SLOT or pass --slot.")

    filename = args.filename.strip() if args.filename else ""
    if not filename:
        raise SystemExit("Filename is required. Set FILENAME or pass --filename.")

    print_title("Presign File")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    log("Slot: " + slot)
    log("Filename: " + filename)
    if args.content_type:
        log("Content type: " + args.content_type)

    body = {
        "canvasId": canvas_id,
        "nodeId": node_id,
        "slot": slot,
        "filename": filename,
    }
    if args.content_type:
        body["contentType"] = args.content_type

    request_json(
        method="POST",
        path="/files/presign",
        body=body,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
