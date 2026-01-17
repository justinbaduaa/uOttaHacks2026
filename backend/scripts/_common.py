import json
import os
import sys
from datetime import datetime
from urllib import error, parse, request


def load_dotenv() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(os.path.dirname(script_dir), ".env"),
        os.path.join(script_dir, ".env"),
    ]

    for path in candidates:
        if not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip()
                if not key or key in os.environ:
                    continue
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ[key] = value


load_dotenv()


def log(message: str) -> None:
    print(message, flush=True)


def print_title(title: str) -> None:
    log("")
    log("==== " + title + " ====")


def resolve_env(value: str, env_name: str) -> str:
    if value:
        return value
    return os.getenv(env_name, "")


def get_api_base_url(api_base_url: str) -> str:
    url = resolve_env(api_base_url, "API_BASE_URL").strip()
    if not url:
        raise SystemExit("API base URL is required. Set API_BASE_URL or pass --api-base-url.")
    return url.rstrip("/")


def get_auth_header(auth_token: str) -> str:
    token = resolve_env(auth_token, "AUTH_TOKEN").strip()
    if not token:
        raise SystemExit("Auth token is required. Set AUTH_TOKEN or pass --auth-token.")
    if not token.startswith("Bearer "):
        token = "Bearer " + token
    return token


def mask_token(token: str) -> str:
    if not token:
        return ""
    raw = token.replace("Bearer ", "")
    if len(raw) <= 8:
        return "Bearer " + ("*" * len(raw))
    return "Bearer " + raw[:4] + "***" + raw[-4:]


def build_url(base_url: str, path: str, query: dict | None) -> str:
    if not path.startswith("/"):
        path = "/" + path
    url = base_url + path
    if query:
        filtered = {k: v for k, v in query.items() if v not in (None, "")}
        if filtered:
            url += "?" + parse.urlencode(filtered)
    return url


def dump_json(data: object) -> str:
    return json.dumps(data, indent=2, ensure_ascii=True)


def request_json(
    method: str,
    path: str,
    query: dict | None = None,
    body: object | None = None,
    api_base_url: str | None = None,
    auth_token: str | None = None,
) -> dict:
    base_url = get_api_base_url(api_base_url)
    auth_header = get_auth_header(auth_token)
    url = build_url(base_url, path, query or {})

    headers = {
        "Authorization": auth_header,
        "Accept": "application/json",
    }

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    print_title("Request")
    log("Time (UTC): " + datetime.utcnow().isoformat() + "Z")
    log("Method: " + method)
    log("URL: " + url)
    log("Headers:")
    log(dump_json({
        "Authorization": mask_token(auth_header),
        "Accept": headers.get("Accept"),
        "Content-Type": headers.get("Content-Type"),
    }))
    if body is not None:
        log("Body:")
        log(dump_json(body))
    else:
        log("Body: <empty>")

    req = request.Request(url, method=method, headers=headers, data=data)

    try:
        with request.urlopen(req) as response:
            status = response.status
            response_headers = dict(response.headers)
            raw_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        status = exc.code
        response_headers = dict(exc.headers)
        raw_body = exc.read().decode("utf-8")
        log("HTTPError: " + str(exc))
    except error.URLError as exc:
        log("Network error: " + str(exc))
        raise SystemExit(1)

    print_title("Response")
    log("Status: " + str(status))
    log("Headers:")
    log(dump_json(response_headers))
    log("Body:")
    if raw_body:
        try:
            parsed = json.loads(raw_body)
            log(dump_json(parsed))
        except ValueError:
            log(raw_body)
    else:
        log("<empty>")

    return {
        "status": status,
        "headers": response_headers,
        "raw_body": raw_body,
    }
