import argparse
import json
import os

from _common import log, print_title, request_json


def load_json_arg(raw: str, label: str) -> object:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise SystemExit(f"{label} must be valid JSON: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update an existing node.")
    parser.add_argument("--canvas-id", default=os.getenv("CANVAS_ID", ""), help="Canvas ID (UUID)")
    parser.add_argument("--node-id", default=os.getenv("NODE_ID", ""), help="Node ID (UUID)")
    parser.add_argument("--title", default=os.getenv("NODE_TITLE", ""), help="Node title")
    parser.add_argument("--description", default=os.getenv("NODE_DESCRIPTION", ""), help="Node description")
    parser.add_argument("--inputs-json", default=os.getenv("NODE_INPUTS_JSON", ""), help="JSON array for inputs")
    parser.add_argument("--outputs-json", default=os.getenv("NODE_OUTPUTS_JSON", ""), help="JSON array for outputs")
    parser.add_argument("--evidence-json", default=os.getenv("NODE_EVIDENCE_JSON", ""), help="JSON array for evidence")
    parser.add_argument("--body-json", default=os.getenv("NODE_BODY_JSON", ""), help="Raw JSON object to merge")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    canvas_id = args.canvas_id.strip() if args.canvas_id else ""
    if not canvas_id:
        raise SystemExit("Canvas ID is required. Set CANVAS_ID or pass --canvas-id.")

    node_id = args.node_id.strip() if args.node_id else ""
    if not node_id:
        raise SystemExit("Node ID is required. Set NODE_ID or pass --node-id.")

    inputs = load_json_arg(args.inputs_json, "inputs-json")
    outputs = load_json_arg(args.outputs_json, "outputs-json")
    evidence = load_json_arg(args.evidence_json, "evidence-json")
    extra_body = load_json_arg(args.body_json, "body-json")

    print_title("Update Node")
    log("Canvas ID: " + canvas_id)
    log("Node ID: " + node_id)
    if args.title:
        log("Title: " + args.title)
    if args.description:
        log("Description: " + args.description)
    if inputs is not None:
        log("Inputs JSON provided")
    if outputs is not None:
        log("Outputs JSON provided")
    if evidence is not None:
        log("Evidence JSON provided")

    body = {
        "canvasId": canvas_id,
    }
    if args.title:
        body["title"] = args.title
    if args.description:
        body["description"] = args.description
    if inputs is not None:
        body["inputs"] = inputs
    if outputs is not None:
        body["outputs"] = outputs
    if evidence is not None:
        body["evidence"] = evidence
    if extra_body is not None:
        if not isinstance(extra_body, dict):
            raise SystemExit("body-json must be a JSON object")
        body.update(extra_body)

    request_json(
        method="PATCH",
        path="/nodes/" + node_id,
        body=body,
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
