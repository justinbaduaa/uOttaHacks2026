import argparse
import os

from _common import log, print_title, request_json


def main() -> None:
    parser = argparse.ArgumentParser(description="Join a canvas by join code.")
    parser.add_argument("--join-code", default=os.getenv("JOIN_CODE", ""), help="Join code")
    parser.add_argument("--api-base-url", default=os.getenv("API_BASE_URL", ""), help="API base URL")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN", ""), help="Bearer token or raw token")
    args = parser.parse_args()

    join_code = args.join_code.strip() if args.join_code else ""
    if not join_code:
        raise SystemExit("Join code is required. Set JOIN_CODE or pass --join-code.")

    print_title("Join Canvas")
    log("Join code: " + join_code)

    request_json(
        method="POST",
        path="/canvases/join",
        body={"joinCode": join_code},
        api_base_url=args.api_base_url,
        auth_token=args.auth_token,
    )


if __name__ == "__main__":
    main()
