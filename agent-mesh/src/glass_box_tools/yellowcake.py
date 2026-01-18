"""
Yellowcake extraction tool for Glass Box agents.
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from urllib import error as url_error
from urllib import request as url_request

log = logging.getLogger(__name__)


async def yellowcake_extract(
    url: str,
    prompt: str,
    throttle: Optional[bool] = None,
    login_url: Optional[str] = None,
    authorized_urls: Optional[List[str]] = None,
    tool_context: Any = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Extract structured data from a URL using Yellowcake.

    Args:
        url: Target URL to extract from.
        prompt: Natural language description of the data to extract.
        throttle: Optional throttle mode for slower, stealthier requests.
        login_url: Optional login URL for auth-walled sites.
        authorized_urls: Optional allowlist of navigable URLs.

    Returns:
        A dictionary with status, result, and any progress events captured.
    """
    if not url or not prompt:
        return {
            "status": "error",
            "message": "url and prompt are required",
        }

    config = tool_config or {}
    api_key = config.get("api_key") or ""
    if not api_key:
        return {
            "status": "error",
            "message": "Yellowcake API key is not configured",
        }

    base_url = config.get("base_url") or "https://api.yellowcake.dev/v1/extract-stream"
    timeout_seconds = int(config.get("timeout_seconds", 900))

    request_body: Dict[str, Any] = {
        "url": url,
        "prompt": prompt,
    }
    if throttle is not None:
        request_body["throttle"] = throttle
    if login_url:
        request_body["loginURL"] = login_url
    if authorized_urls:
        request_body["authorizedURLs"] = authorized_urls

    return await asyncio.to_thread(
        _run_yellowcake_request,
        base_url,
        api_key,
        request_body,
        timeout_seconds,
    )


def _run_yellowcake_request(
    base_url: str,
    api_key: str,
    request_body: Dict[str, Any],
    timeout_seconds: int,
) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
    }

    data = json.dumps(request_body).encode("utf-8")
    req = url_request.Request(base_url, method="POST", headers=headers, data=data)

    event_type = ""
    data_buffer = ""
    progress_events: List[Dict[str, Any]] = []
    complete_payload = None

    try:
        with url_request.urlopen(req, timeout=timeout_seconds) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if not line:
                    if event_type and data_buffer:
                        parsed = _parse_json_safely(data_buffer)
                        if event_type == "complete":
                            complete_payload = parsed
                        else:
                            progress_events.append({
                                "event": event_type,
                                "data": parsed,
                            })
                    event_type = ""
                    data_buffer = ""
                    continue
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                    continue
                if line.startswith("data:"):
                    data_line = line[5:].strip()
                    if data_buffer:
                        data_buffer += "\n" + data_line
                    else:
                        data_buffer = data_line
                    continue
    except url_error.HTTPError as exc:
        error_body = exc.read().decode("utf-8")
        return {
            "status": "error",
            "message": "Yellowcake request failed",
            "details": {
                "status": exc.code,
                "body": error_body,
            },
        }
    except url_error.URLError as exc:
        return {
            "status": "error",
            "message": "Yellowcake request failed",
            "details": {"error": str(exc)},
        }

    if complete_payload is None:
        return {
            "status": "error",
            "message": "Yellowcake did not return a complete event",
            "progressEvents": progress_events,
        }

    return {
        "status": "success",
        "result": complete_payload,
        "progressEvents": progress_events,
    }


def _parse_json_safely(raw_data: str) -> Any:
    try:
        return json.loads(raw_data)
    except ValueError:
        return raw_data
