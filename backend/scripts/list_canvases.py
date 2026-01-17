import argparse
import os

from _common import print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="List canvases for the current user.")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    print_title("List Canvases")

    request_json(
        method="GET",
        path="/canvases",
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
