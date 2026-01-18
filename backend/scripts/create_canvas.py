import argparse
import os
from datetime import datetime

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a new canvas.")
    parser.add_argument(
        "--name", default=os.getenv("CANVAS_NAME", ""), help="Canvas name")
    parser.add_argument(
        "--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN",
                        ""), help="Bearer token or raw token")
    args = parser.parse_args()

    name = args.name.strip() if args.name else ""
    if not name:
        name = "Test Canvas " + datetime.utcnow().strftime("%Y%m%d-%H%M%S")

    print_title("Create Canvas")
    log("Name: " + name)

    request_json(
        method="POST",
        path="/canvases",
        body={"name": name},
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
