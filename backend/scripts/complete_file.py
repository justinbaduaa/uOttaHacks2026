import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Complete a file upload and attach it to a node.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--slot", default=os.getenv("FILE_SLOT", ""), help="inputs or outputs")
    parser.add_argument("--file-id", default=os.getenv("FILE_ID", ""), help="File ID")
    parser.add_argument("--s3-key", default=os.getenv("S3_KEY", ""), help="S3 key")
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

    file_id = args.file_id.strip() if args.file_id else ""
    if not file_id:
        raise SystemExit("File ID is required. Set FILE_ID or pass --file-id.")

    s3_key = args.s3_key.strip() if args.s3_key else ""
    if not s3_key:
        raise SystemExit("S3 key is required. Set S3_KEY or pass --s3-key.")

    filename = args.filename.strip() if args.filename else ""
    if not filename:
        raise SystemExit("Filename is required. Set FILENAME or pass --filename.")

    print_title("Complete File")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    log("Slot: " + slot)
    log("File ID: " + file_id)
    log("S3 key: " + s3_key)
    log("Filename: " + filename)
    if args.content_type:
        log("Content type: " + args.content_type)

    body = {
        "canvasId": canvas_id,
        "nodeId": node_id,
        "slot": slot,
        "fileId": file_id,
        "s3Key": s3_key,
        "filename": filename,
    }
    if args.content_type:
        body["contentType"] = args.content_type

    request_json(
        method="POST",
        path="/files/complete",
        body=body,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
