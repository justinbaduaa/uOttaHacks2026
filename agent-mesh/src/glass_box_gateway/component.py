"""
Solace Agent Mesh Component class for the GlassBoxGateway Gateway.
"""

import asyncio
import base64
import json
import logging
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from a2a.types import (
    DataPart,
    FilePart,
    JSONRPCError,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
    TextPart,
)
from solace_agent_mesh.common import a2a
from solace_agent_mesh.common.a2a import ContentPart
from solace_agent_mesh.gateway.base.component import BaseGatewayComponent

log = logging.getLogger(__name__)

info = {
    "class_name": "GlassBoxGatewayGatewayComponent",
    "description": (
        "Implements the A2A GlassBoxGateway Gateway, inheriting from BaseGatewayComponent. "
        "Handles communication between the Glass Box backend and the A2A agent ecosystem."
    ),
    "config_parameters": [],
    "input_schema": {},
    "output_schema": {},
}


class BackendError(Exception):
    """Represents backend API errors."""

    def __init__(self, message: str, status: Optional[int] = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.details = details


class _GatewayHttpServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: Tuple[str, int],
        handler_class: type,
        component: "GlassBoxGatewayGatewayComponent",
    ) -> None:
        super().__init__(server_address, handler_class)
        self.component = component


class _ExecuteRequestHandler(BaseHTTPRequestHandler):
    server_version = "GlassBoxGateway/1.0"

    def do_POST(self) -> None:
        component = self.server.component
        if self.path.rstrip("/") != "/execute":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except ValueError:
            self._write_json(400, {"ok": False, "error": "Invalid JSON body"})
            return

        shared_secret = component.gateway_shared_secret
        if shared_secret:
            provided = self.headers.get("X-Glassbox-Token", "")
            if provided != shared_secret:
                self._write_json(401, {"ok": False, "error": "Unauthorized"})
                return

        if not component.async_loop or not component.async_loop.is_running():
            self._write_json(503, {"ok": False, "error": "Gateway not ready"})
            return

        try:
            future = asyncio.run_coroutine_threadsafe(
                component.handle_execute_request(payload, dict(self.headers)),
                component.async_loop,
            )
            result = future.result(timeout=component.backend_timeout_seconds)
            self._write_json(200, {"ok": True, "data": result})
        except Exception as exc:
            log.exception("Execute request failed: %s", exc)
            self._write_json(500, {"ok": False, "error": str(exc)})

    def do_GET(self) -> None:
        component = self.server.component
        if not self.path.startswith("/stream"):
            self.send_response(404)
            self.end_headers()
            return

        if not component.async_loop or not component.async_loop.is_running():
            self._write_json(503, {"ok": False, "error": "Gateway not ready"})
            return

        try:
            component.handle_stream_request(self)
        except Exception as exc:
            log.exception("Stream request failed: %s", exc)

    def log_message(self, format: str, *args: Any) -> None:
        log.info("GatewayHTTP %s - %s", self.address_string(), format % args)

    def _write_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class GlassBoxGatewayGatewayComponent(BaseGatewayComponent):
    """
    Solace Agent Mesh Component implementing the A2A GlassBoxGateway Gateway.
    """

    def __init__(self, **kwargs: Any):
        super().__init__(**kwargs)
        log.info(
            "%s Initializing GlassBoxGateway Gateway Component (Post-Base)...",
            self.log_identifier,
        )

        self.gateway_host = self.get_config("gateway_host", "127.0.0.1")
        self.gateway_port = int(self.get_config("gateway_port", 8001))
        self.gateway_shared_secret = self.get_config("gateway_shared_secret", "")

        self.backend_api_base_url = self.get_config("backend_api_base_url")
        self.backend_auth_mode = self.get_config("backend_auth_mode", "service_token")
        self.backend_service_token = self.get_config("backend_service_token", "")
        self.backend_timeout_seconds = int(self.get_config("backend_timeout_seconds", 30))
        self.approval_mode_default = self.get_config("approval_mode_default", "approve_nodes")
        self.node_budget_max_children = int(self.get_config("node_budget_max_children", 3))
        self.node_budget_max_depth = int(self.get_config("node_budget_max_depth", 3))
        self.artifact_upload_mode = self.get_config("artifact_upload_mode", "s3")
        self.approval_poll_interval_seconds = int(
            self.get_config("approval_poll_interval_seconds", 5)
        )
        self.stream_poll_interval_seconds = int(
            self.get_config("stream_poll_interval_seconds", 3)
        )

        self._http_server: Optional[_GatewayHttpServer] = None
        self._http_thread: Optional[threading.Thread] = None
        self._approval_poll_task: Optional[asyncio.Task] = None
        self._pending_approvals: Dict[str, Dict[str, Any]] = {}

        log.info(
            "%s GlassBoxGateway Gateway Component initialization complete.",
            self.log_identifier,
        )

    def _start_listener(self) -> None:
        log_id_prefix = f"{self.log_identifier}[StartListener]"
        log.info("%s Starting gateway HTTP listener...", log_id_prefix)

        try:
            self._http_server = _GatewayHttpServer(
                (self.gateway_host, self.gateway_port),
                _ExecuteRequestHandler,
                self,
            )
            self._http_thread = threading.Thread(
                target=self._http_server.serve_forever,
                name="GlassBoxGatewayHTTP",
                daemon=True,
            )
            self._http_thread.start()
        except OSError as exc:
            log.error("%s Failed to start HTTP server: %s", log_id_prefix, exc)
            self.stop_signal.set()
            return

        if self.async_loop and self.async_loop.is_running():
            self._approval_poll_task = self.async_loop.create_task(self._approval_poll_loop())

        log.info("%s Gateway HTTP listener started.", log_id_prefix)

    def _stop_listener(self) -> None:
        log_id_prefix = f"{self.log_identifier}[StopListener]"
        log.info("%s Stopping gateway HTTP listener...", log_id_prefix)

        if self._http_server:
            self._http_server.shutdown()
            self._http_server.server_close()
            self._http_server = None

        if self._http_thread and self._http_thread.is_alive():
            self._http_thread.join(timeout=5)
            self._http_thread = None

        if self._approval_poll_task and not self._approval_poll_task.done():
            self._approval_poll_task.cancel()
            self._approval_poll_task = None

        log.info("%s Gateway HTTP listener stopped.", log_id_prefix)

    async def handle_execute_request(
        self, payload: Dict[str, Any], headers: Dict[str, Any]
    ) -> Dict[str, Any]:
        canvas_id = payload.get("canvasId")
        node_id = payload.get("nodeId")
        if not canvas_id or not node_id:
            raise BackendError("canvasId and nodeId are required")

        if self.backend_auth_mode == "user_token" and not payload.get("userToken"):
            auth_header = headers.get("Authorization") or headers.get("authorization")
            if auth_header:
                payload["userToken"] = auth_header

        auth_token = self._resolve_backend_token(payload)
        node = await self._backend_get_node(canvas_id, node_id, auth_token)

        assigned_to = node.get("assignedTo") or {}
        if assigned_to.get("type") != "agent":
            raise BackendError("Node is not assigned to an agent")

        approval_mode = payload.get("approvalMode") or node.get("approvalMode")
        if not approval_mode:
            approval_mode = self.approval_mode_default

        resolved_inputs, file_parts = await self._resolve_inputs_with_files(
            canvas_id, node, auth_token
        )
        task_context = {
            "type": "glassbox_task",
            "node": {
                "nodeId": node.get("nodeId"),
                "canvasId": node.get("canvasId"),
                "title": node.get("title"),
                "description": node.get("description"),
                "assignedTo": assigned_to,
            },
            "inputs": resolved_inputs,
            "approvalMode": approval_mode,
            "nodeBudget": {
                "maxChildren": self.node_budget_max_children,
                "maxDepth": self.node_budget_max_depth,
            },
        }

        a2a_parts = [
            a2a.create_text_part(
                text=(
                    "Execute the Glass Box node below. Use provided inputs and "
                    "return evidence/outputs via structured actions and artifacts."
                )
            ),
            a2a.create_data_part(data=task_context),
        ]
        a2a_parts.extend(file_parts)

        if resolved_inputs:
            a2a_parts.append(
                a2a.create_text_part(
                    text=self._format_inputs_summary(resolved_inputs)
                )
            )

        external_request_context = {
            "canvas_id": canvas_id,
            "node_id": node_id,
            "approval_mode": approval_mode,
            "assigned_agent": assigned_to.get("id"),
            "auth_token": auth_token,
            "author_sub": node.get("authorSub"),
        }

        user_identity = {
            "id": node.get("authorSub") or "glassbox_user",
            "source": "glassbox",
        }

        target_agent = assigned_to.get("id") or "GlassBoxWorker"

        task_id = await self.submit_a2a_task(
            target_agent_name=target_agent,
            a2a_parts=a2a_parts,
            external_request_context=external_request_context,
            user_identity=user_identity,
            is_streaming=True,
        )

        log_entry = self._build_log_entry(
            entry_type="status",
            message=f"Execution started for agent {target_agent}",
            data={"taskId": task_id},
        )
        await self._update_node(
            canvas_id,
            node_id,
            auth_token,
            {
                "status": "in_progress",
                "activeTaskId": task_id,
                "approvalMode": approval_mode,
                "activityLog": self._append_log(node.get("activityLog", []), log_entry),
            },
        )

        return {"taskId": task_id, "approvalMode": approval_mode}

    def handle_stream_request(self, handler: BaseHTTPRequestHandler) -> None:
        parsed = url_parse.urlparse(handler.path)
        query = url_parse.parse_qs(parsed.query)
        canvas_id = self._first_query_value(query, "canvasId")
        node_id = self._first_query_value(query, "nodeId")
        since = self._first_query_value(query, "since") or ""

        if not canvas_id or not node_id:
            self._write_stream_error(handler, "canvasId and nodeId are required")
            return

        payload: Dict[str, Any] = {}
        auth_header = handler.headers.get("Authorization") or handler.headers.get("authorization")
        if auth_header:
            payload["userToken"] = auth_header

        try:
            auth_token = self._resolve_backend_token(payload)
        except BackendError as exc:
            self._write_stream_error(handler, str(exc))
            return

        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("Cache-Control", "no-cache")
        handler.send_header("Connection", "keep-alive")
        handler.end_headers()
        handler.wfile.write(b"retry: 3000\n\n")
        handler.wfile.flush()

        last_seen = since
        while not self.stop_signal.is_set():
            try:
                node = self._get_node_for_stream(canvas_id, node_id, auth_token)
                entries = self._filter_activity_log(node.get("activityLog", []), last_seen)
                if entries:
                    last_seen = entries[-1].get("createdAt", last_seen)
                    payload = {
                        "canvasId": canvas_id,
                        "nodeId": node_id,
                        "entries": entries,
                    }
                    self._write_stream_event(handler, "activity_log", payload)
                else:
                    self._write_stream_comment(handler, "keep-alive")
                time.sleep(self.stream_poll_interval_seconds)
            except (BrokenPipeError, ConnectionResetError):
                break
            except Exception as exc:
                log.exception("Stream polling failed: %s", exc)
                self._write_stream_event(handler, "error", {"message": str(exc)})
                time.sleep(self.stream_poll_interval_seconds)

    async def _extract_initial_claims(
        self, external_event_data: Any
    ) -> Optional[Dict[str, Any]]:
        user_id = None
        if isinstance(external_event_data, dict):
            user_id = external_event_data.get("userId") or external_event_data.get("userSub")
        if not user_id:
            user_id = "glassbox_gateway_user"
        return {"id": user_id, "source": "glassbox"}

    async def _translate_external_input(
        self, external_event_data: Any
    ) -> Tuple[str, List[ContentPart], Dict[str, Any]]:
        if not isinstance(external_event_data, dict):
            raise ValueError("External input must be a dict payload")

        canvas_id = external_event_data.get("canvasId")
        node_id = external_event_data.get("nodeId")
        if not canvas_id or not node_id:
            raise ValueError("canvasId and nodeId are required")

        auth_token = self._resolve_backend_token(external_event_data)
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        assigned_to = node.get("assignedTo") or {}
        target_agent = assigned_to.get("id") or "GlassBoxWorker"

        resolved_inputs, file_parts = await self._resolve_inputs_with_files(
            canvas_id, node, auth_token
        )
        a2a_parts = [
            a2a.create_text_part(text="Execute the Glass Box node task."),
            a2a.create_data_part(
                data={
                    "type": "glassbox_task",
                    "node": node,
                    "inputs": resolved_inputs,
                }
            ),
        ]
        a2a_parts.extend(file_parts)

        external_request_context = {
            "canvas_id": canvas_id,
            "node_id": node_id,
            "approval_mode": node.get("approvalMode") or self.approval_mode_default,
            "assigned_agent": assigned_to.get("id"),
            "auth_token": auth_token,
        }

        return target_agent, a2a_parts, external_request_context

    async def _send_final_response_to_external(
        self, external_request_context: Dict[str, Any], task_data: Task
    ) -> None:
        log_id_prefix = f"{self.log_identifier}[SendFinalResponse]"
        task_id = self._get_task_id(task_data)
        task_status = self._get_task_status(task_data)

        canvas_id = external_request_context.get("canvas_id")
        node_id = external_request_context.get("node_id")
        auth_token = external_request_context.get("auth_token")

        if not canvas_id or not node_id or not auth_token:
            log.warning("%s Missing context to update node completion.", log_id_prefix)
            return

        if task_status in [TaskState.failed, TaskState.canceled]:
            log_entry = self._build_log_entry(
                entry_type="error",
                message=f"Task {task_id} ended with status {task_status}",
                data={},
            )
            node = await self._backend_get_node(canvas_id, node_id, auth_token)
            updated_log = self._append_log(node.get("activityLog", []), log_entry)
            await self._update_node(
                canvas_id,
                node_id,
                auth_token,
                {
                    "status": "failed",
                    "activityLog": updated_log,
                },
            )
            return

        log_entry = self._build_log_entry(
            entry_type="status",
            message=f"Task {task_id} completed",
            data={},
        )
        await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)

    async def _send_error_to_external(
        self, external_request_context: Dict[str, Any], error_data: JSONRPCError
    ) -> None:
        log_id_prefix = f"{self.log_identifier}[SendError]"
        error_message = self._get_error_message(error_data)
        log.warning("%s A2A error: %s", log_id_prefix, error_message)

        canvas_id = external_request_context.get("canvas_id")
        node_id = external_request_context.get("node_id")
        auth_token = external_request_context.get("auth_token")
        if not canvas_id or not node_id or not auth_token:
            return

        log_entry = self._build_log_entry(
            entry_type="error",
            message=f"A2A error: {error_message}",
            data={},
        )
        await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)

    async def _send_update_to_external(
        self,
        external_request_context: Dict[str, Any],
        event_data: Any,
        is_final_chunk_of_update: bool,
    ) -> None:
        if isinstance(event_data, TaskStatusUpdateEvent):
            await self._handle_status_update(
                external_request_context, event_data, is_final_chunk_of_update
            )
            return

        if isinstance(event_data, TaskArtifactUpdateEvent):
            await self._handle_artifact_update(external_request_context, event_data)
            return

        log.debug(
            "%s Ignoring unsupported update type: %s",
            self.log_identifier,
            type(event_data).__name__,
        )

    async def _handle_status_update(
        self,
        external_request_context: Dict[str, Any],
        event_data: TaskStatusUpdateEvent,
        is_final_chunk: bool,
    ) -> None:
        canvas_id = external_request_context.get("canvas_id")
        node_id = external_request_context.get("node_id")
        auth_token = external_request_context.get("auth_token")
        if not canvas_id or not node_id or not auth_token:
            return

        message = self._get_status_message(event_data)
        if not message:
            return

        parts = self._get_message_parts(message)
        for part in parts:
            if isinstance(part, TextPart):
                text = part.text.strip()
                if not text:
                    continue
                log_entry = self._build_log_entry(
                    entry_type="status",
                    message=text,
                    data={"finalChunk": is_final_chunk},
                )
                await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
            elif isinstance(part, DataPart):
                data = self._get_data_from_part(part)
                await self._handle_data_part(
                    external_request_context, data
                )

    async def _handle_data_part(
        self, external_request_context: Dict[str, Any], data: Dict[str, Any]
    ) -> None:
        canvas_id = external_request_context.get("canvas_id")
        node_id = external_request_context.get("node_id")
        auth_token = external_request_context.get("auth_token")
        approval_mode = external_request_context.get("approval_mode", self.approval_mode_default)

        if not canvas_id or not node_id or not auth_token:
            return

        data_type = data.get("type")
        if data_type == "agent_progress_update":
            status_text = data.get("status_text")
            if status_text:
                log_entry = self._build_log_entry(
                    entry_type="status",
                    message=status_text,
                    data={},
                )
                await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
            return

        if data_type not in ["glassbox_action", "glassbox_action_request"]:
            return

        action = data.get("action")
        payload = data.get("payload", {})
        rationale = data.get("rationale")
        if not action:
            return

        requires_approval = self._requires_approval(action, approval_mode)
        if requires_approval:
            await self._request_approval(
                canvas_id,
                node_id,
                auth_token,
                action,
                payload,
                rationale,
                external_request_context,
            )
            return

        await self._execute_action(
            canvas_id,
            node_id,
            auth_token,
            action,
            payload,
            approval_mode,
        )

    async def _handle_artifact_update(
        self,
        external_request_context: Dict[str, Any],
        event_data: TaskArtifactUpdateEvent,
    ) -> None:
        canvas_id = external_request_context.get("canvas_id")
        node_id = external_request_context.get("node_id")
        auth_token = external_request_context.get("auth_token")
        if not canvas_id or not node_id or not auth_token:
            return

        artifact = self._get_artifact_from_update(event_data)
        if not artifact:
            return

        parts = self._get_artifact_parts(artifact)
        for part in parts:
            if not isinstance(part, FilePart):
                continue
            await self._handle_artifact_file(
                canvas_id, node_id, auth_token, part
            )

    async def _handle_artifact_file(
        self, canvas_id: str, node_id: str, auth_token: str, part: FilePart
    ) -> None:
        file_content = part.file
        filename = getattr(file_content, "name", "artifact.bin")
        mime_type = getattr(file_content, "mimeType", "application/octet-stream")
        file_bytes = self._extract_file_bytes(file_content)
        if not file_bytes:
            log_entry = self._build_log_entry(
                entry_type="error",
                message=f"Artifact {filename} had no content bytes",
                data={},
            )
            await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
            return

        slot = self._determine_slot_from_filename(filename)
        if self.artifact_upload_mode == "s3":
            await self._upload_artifact_to_s3(
                canvas_id, node_id, auth_token, filename, mime_type, file_bytes, slot
            )
            return

        if self.artifact_upload_mode == "reference":
            uri = getattr(file_content, "uri", "")
            item = {"type": "link", "url": uri or filename}
            await self._append_item_to_node(
                canvas_id, node_id, auth_token, slot, item
            )
            return

        encoded = base64.b64encode(file_bytes).decode("ascii")
        item = {"type": "text", "text": f"{filename} (base64): {encoded}"}
        await self._append_item_to_node(
            canvas_id, node_id, auth_token, slot, item
        )

    async def _execute_action(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        action: str,
        payload: Dict[str, Any],
        approval_mode: str,
    ) -> None:
        if action == "propose_subnode":
            await self._create_subnode(
                canvas_id, node_id, auth_token, payload, approval_mode
            )
            return
        if action == "add_output":
            await self._append_item_to_node(
                canvas_id, node_id, auth_token, "outputs", payload.get("item")
            )
            return
        if action == "add_evidence":
            await self._append_item_to_node(
                canvas_id, node_id, auth_token, "evidence", payload.get("item")
            )
            return
        if action == "complete_node":
            await self._complete_node(
                canvas_id, node_id, auth_token, payload
            )
            return

        log_entry = self._build_log_entry(
            entry_type="status",
            message=f"Ignored unknown action: {action}",
            data={},
        )
        await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)

    async def _create_subnode(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        payload: Dict[str, Any],
        approval_mode: str,
    ) -> None:
        if not await self._within_node_budget(canvas_id, node_id, auth_token):
            log_entry = self._build_log_entry(
                entry_type="status",
                message="Subnode creation denied: node budget exceeded",
                data={},
            )
            await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
            return

        title = payload.get("title") or "Agent Proposed Subnode"
        description = payload.get("description", "")
        inputs = payload.get("inputs", [])
        outputs = payload.get("outputs", [])
        evidence = payload.get("evidence", [])
        assigned_to = payload.get("assignedTo")
        if not assigned_to:
            assigned_to = {"type": "agent", "id": payload.get("agent") or "GlassBoxWorker"}

        body = {
            "canvasId": canvas_id,
            "parentNodeId": node_id,
            "title": title,
            "description": description,
            "inputs": inputs,
            "outputs": outputs,
            "evidence": evidence,
            "approvalMode": payload.get("approvalMode") or approval_mode,
            "assignedTo": assigned_to,
            "status": payload.get("status") or "draft",
        }

        created = await self._backend_create_node(auth_token, body)
        child_node_id = created.get("nodeId")
        if child_node_id:
            await self._append_item_to_node(
                canvas_id,
                node_id,
                auth_token,
                "evidence",
                {
                    "type": "node",
                    "nodeId": child_node_id,
                    "include": "all",
                },
            )
        log_entry = self._build_log_entry(
            entry_type="action",
            message=f"Created subnode: {title}",
            data={},
        )
        await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)

    async def _complete_node(
        self, canvas_id: str, node_id: str, auth_token: str, payload: Dict[str, Any]
    ) -> None:
        summary = payload.get("summary")
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        evidence = node.get("evidence", [])
        if summary:
            evidence.append({"type": "text", "text": summary})

        if summary:
            await self._update_node(
                canvas_id,
                node_id,
                auth_token,
                {"evidence": evidence},
            )

        if node.get("assignedTo", {}).get("type") == "agent":
            await self._attach_activity_log_evidence(canvas_id, node_id, auth_token)

        node_after = await self._backend_get_node(canvas_id, node_id, auth_token)
        evidence = node_after.get("evidence", [])
        if not evidence and node.get("assignedTo", {}).get("type") == "agent":
            log_entry = self._build_log_entry(
                entry_type="status",
                message="Completion blocked: evidence required",
                data={},
            )
            await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
            return

        await self._update_node(
            canvas_id,
            node_id,
            auth_token,
            {
                "status": "completed",
                "activeTaskId": None,
            },
        )
        log_entry = self._build_log_entry(
            entry_type="status",
            message="Node marked completed",
            data={},
        )
        await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)

    async def _request_approval(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        action: str,
        payload: Dict[str, Any],
        rationale: Optional[str],
        external_request_context: Dict[str, Any],
    ) -> None:
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        approval_id = str(uuid.uuid4())
        approval_request = {
            "approvalId": approval_id,
            "type": action,
            "status": "pending",
            "requestedAt": self._utc_now(),
            "requestedBy": {
                "type": "agent",
                "id": external_request_context.get("assigned_agent") or "unknown",
            },
            "payload": payload,
        }
        if rationale:
            approval_request["rationale"] = rationale

        approval_requests = node.get("approvalRequests", [])
        approval_requests.append(approval_request)

        log_entry = self._build_log_entry(
            entry_type="approval",
            message=f"Approval requested for action: {action}",
            data={"approvalId": approval_id, "rationale": rationale},
        )

        await self._update_node(
            canvas_id,
            node_id,
            auth_token,
            {
                "approvalRequests": approval_requests,
                "activityLog": self._append_log(node.get("activityLog", []), log_entry),
            },
        )

        self._pending_approvals[approval_id] = {
            "canvas_id": canvas_id,
            "node_id": node_id,
            "auth_token": auth_token,
            "action": action,
            "payload": payload,
            "approval_mode": external_request_context.get("approval_mode"),
        }

    async def _approval_poll_loop(self) -> None:
        while not self.stop_signal.is_set():
            if not self._pending_approvals:
                await asyncio.sleep(self.approval_poll_interval_seconds)
                continue

            for approval_id in list(self._pending_approvals.keys()):
                context = self._pending_approvals.get(approval_id)
                if not context:
                    continue
                canvas_id = context.get("canvas_id")
                node_id = context.get("node_id")
                auth_token = context.get("auth_token")
                if not canvas_id or not node_id or not auth_token:
                    self._pending_approvals.pop(approval_id, None)
                    continue

                node = await self._backend_get_node(canvas_id, node_id, auth_token)
                approval_requests = node.get("approvalRequests", [])
                matching = None
                for request_item in approval_requests:
                    if request_item.get("approvalId") == approval_id:
                        matching = request_item
                        break

                if not matching:
                    self._pending_approvals.pop(approval_id, None)
                    continue

                status = matching.get("status")
                if status == "approved":
                    try:
                        await self._execute_action(
                            canvas_id,
                            node_id,
                            auth_token,
                            context.get("action"),
                            context.get("payload", {}),
                            context.get("approval_mode") or self.approval_mode_default,
                        )
                        matching["status"] = "applied"
                        matching["appliedAt"] = self._utc_now()
                        await self._update_node(
                            canvas_id,
                            node_id,
                            auth_token,
                            {"approvalRequests": approval_requests},
                        )
                        self._pending_approvals.pop(approval_id, None)
                    except Exception as exc:
                        log.exception(
                            "Failed to apply approved action %s: %s",
                            approval_id,
                            exc,
                        )
                elif status == "rejected":
                    log_entry = self._build_log_entry(
                        entry_type="approval",
                        message=f"Approval rejected: {approval_id}",
                        data={},
                    )
                    await self._append_activity_log(canvas_id, node_id, auth_token, log_entry)
                    self._pending_approvals.pop(approval_id, None)

            await asyncio.sleep(self.approval_poll_interval_seconds)

    async def _backend_get_node(
        self, canvas_id: str, node_id: str, auth_token: str
    ) -> Dict[str, Any]:
        data = await self._backend_request(
            "GET",
            f"/nodes/{node_id}",
            auth_token,
            query={"canvasId": canvas_id},
        )
        if not isinstance(data, dict):
            raise BackendError("Invalid node response")
        return data

    async def _backend_list_children(
        self, canvas_id: str, parent_node_id: str, auth_token: str
    ) -> List[Dict[str, Any]]:
        data = await self._backend_request(
            "GET",
            "/nodes",
            auth_token,
            query={"canvasId": canvas_id, "parentNodeId": parent_node_id},
        )
        if isinstance(data, list):
            return data
        return []

    async def _backend_create_node(
        self, auth_token: str, body: Dict[str, Any]
    ) -> Dict[str, Any]:
        data = await self._backend_request("POST", "/nodes", auth_token, body=body)
        if not isinstance(data, dict):
            raise BackendError("Invalid create node response")
        return data

    async def _update_node(
        self, canvas_id: str, node_id: str, auth_token: str, patch: Dict[str, Any]
    ) -> Dict[str, Any]:
        body = {"canvasId": canvas_id}
        body.update(patch)
        data = await self._backend_request(
            "PATCH", f"/nodes/{node_id}", auth_token, body=body
        )
        if not isinstance(data, dict):
            raise BackendError("Invalid update node response")
        return data

    async def _backend_presign_file(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        slot: str,
        filename: str,
        content_type: str,
    ) -> Dict[str, Any]:
        body = {
            "canvasId": canvas_id,
            "nodeId": node_id,
            "slot": slot,
            "filename": filename,
            "contentType": content_type,
        }
        data = await self._backend_request("POST", "/files/presign", auth_token, body=body)
        if not isinstance(data, dict):
            raise BackendError("Invalid presign response")
        return data

    async def _backend_presign_download(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        file_item: Dict[str, Any],
    ) -> Dict[str, Any]:
        body = {
            "canvasId": canvas_id,
            "nodeId": node_id,
        }
        if file_item.get("fileId"):
            body["fileId"] = file_item.get("fileId")
        if file_item.get("s3Key"):
            body["s3Key"] = file_item.get("s3Key")
        data = await self._backend_request(
            "POST", "/files/presign-download", auth_token, body=body
        )
        if not isinstance(data, dict):
            raise BackendError("Invalid presign download response")
        return data

    async def _backend_complete_file(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        slot: str,
        file_item: Dict[str, Any],
    ) -> Dict[str, Any]:
        body = {
            "canvasId": canvas_id,
            "nodeId": node_id,
            "slot": slot,
            "fileId": file_item.get("fileId"),
            "s3Key": file_item.get("s3Key"),
            "filename": file_item.get("filename"),
            "contentType": file_item.get("contentType"),
        }
        data = await self._backend_request("POST", "/files/complete", auth_token, body=body)
        if not isinstance(data, dict):
            raise BackendError("Invalid complete file response")
        return data

    async def _backend_request(
        self,
        method: str,
        path: str,
        auth_token: str,
        query: Optional[Dict[str, str]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        return await asyncio.to_thread(
            self._backend_request_sync, method, path, auth_token, query, body
        )

    def _backend_request_sync(
        self,
        method: str,
        path: str,
        auth_token: str,
        query: Optional[Dict[str, str]],
        body: Optional[Dict[str, Any]],
    ) -> Any:
        if not auth_token:
            raise BackendError("Missing backend auth token")

        base_url = self.backend_api_base_url.rstrip("/")
        url = base_url + path
        if query:
            url += "?" + url_parse.urlencode(query)

        headers = {
            "Authorization": auth_token,
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = url_request.Request(url, method=method, headers=headers, data=data)
        try:
            with url_request.urlopen(req, timeout=self.backend_timeout_seconds) as response:
                raw_body = response.read().decode("utf-8")
                status = response.status
        except url_error.HTTPError as exc:
            raw_body = exc.read().decode("utf-8")
            status = exc.code
        except url_error.URLError as exc:
            raise BackendError(f"Backend request failed: {exc}") from exc

        parsed = None
        if raw_body:
            try:
                parsed = json.loads(raw_body)
            except ValueError:
                parsed = raw_body

        if status >= 400:
            raise BackendError("Backend request failed", status=status, details=parsed)

        if isinstance(parsed, dict) and "data" in parsed:
            return parsed["data"]
        return parsed

    async def _upload_artifact_to_s3(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        filename: str,
        content_type: str,
        file_bytes: bytes,
        slot: str,
    ) -> None:
        presign = await self._backend_presign_file(
            canvas_id, node_id, auth_token, slot, filename, content_type
        )
        upload_url = presign.get("uploadUrl")
        if not upload_url:
            raise BackendError("Missing presigned upload URL")

        await asyncio.to_thread(
            self._upload_bytes_to_url, upload_url, file_bytes, content_type
        )

        file_item = {
            "fileId": presign.get("fileId"),
            "s3Key": presign.get("s3Key"),
            "filename": filename,
            "contentType": content_type,
        }
        await self._backend_complete_file(
            canvas_id, node_id, auth_token, slot, file_item
        )

    async def _attach_activity_log_evidence(
        self, canvas_id: str, node_id: str, auth_token: str
    ) -> None:
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        filename = f"evidence__activity_log_{node_id}.json"
        for item in node.get("evidence", []):
            if item.get("type") == "file" and item.get("filename") == filename:
                return

        activity_log = node.get("activityLog", [])
        payload = {
            "canvasId": canvas_id,
            "nodeId": node_id,
            "activityLog": activity_log,
        }
        content_bytes = json.dumps(payload, indent=2, ensure_ascii=True).encode("utf-8")
        content_type = "application/json"

        presign = await self._backend_presign_file(
            canvas_id, node_id, auth_token, "evidence", filename, content_type
        )
        upload_url = presign.get("uploadUrl")
        if not upload_url:
            raise BackendError("Missing presigned upload URL for activity log")

        await asyncio.to_thread(
            self._upload_bytes_to_url, upload_url, content_bytes, content_type
        )

        file_item = {
            "fileId": presign.get("fileId"),
            "s3Key": presign.get("s3Key"),
            "filename": filename,
            "contentType": content_type,
        }
        await self._backend_complete_file(
            canvas_id, node_id, auth_token, "evidence", file_item
        )

    def _upload_bytes_to_url(self, upload_url: str, file_bytes: bytes, content_type: str) -> None:
        req = url_request.Request(
            upload_url,
            method="PUT",
            data=file_bytes,
            headers={"Content-Type": content_type},
        )
        with url_request.urlopen(req, timeout=self.backend_timeout_seconds):
            pass

    async def _append_item_to_node(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        slot: str,
        item: Any,
    ) -> None:
        if not isinstance(item, dict):
            return
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        current_items = node.get(slot, [])
        current_items.append(item)
        await self._update_node(
            canvas_id,
            node_id,
            auth_token,
            {slot: current_items},
        )

    async def _append_activity_log(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        entry: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        node = await self._backend_get_node(canvas_id, node_id, auth_token)
        updated_log = self._append_log(node.get("activityLog", []), entry)
        await self._update_node(
            canvas_id,
            node_id,
            auth_token,
            {"activityLog": updated_log},
        )
        return updated_log

    async def _resolve_inputs(
        self, canvas_id: str, node: Dict[str, Any], auth_token: str
    ) -> List[Dict[str, Any]]:
        resolved = []
        for item in node.get("inputs", []):
            if item.get("type") != "node":
                resolved.append(item)
                continue
            node_id = item.get("nodeId")
            if not node_id:
                continue
            include = item.get("include") or "outputs"
            referenced = await self._backend_get_node(canvas_id, node_id, auth_token)
            if include in ["outputs", "all"]:
                resolved.extend(referenced.get("outputs", []))
            if include in ["evidence", "all"]:
                resolved.extend(referenced.get("evidence", []))
        return resolved

    async def _resolve_inputs_with_files(
        self, canvas_id: str, node: Dict[str, Any], auth_token: str
    ) -> Tuple[List[Dict[str, Any]], List[ContentPart]]:
        resolved_inputs = await self._resolve_inputs(canvas_id, node, auth_token)
        file_parts = await self._build_file_parts(
            canvas_id, node.get("nodeId", ""), auth_token, resolved_inputs
        )
        return resolved_inputs, file_parts

    async def _build_file_parts(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        inputs: List[Dict[str, Any]],
    ) -> List[ContentPart]:
        file_parts: List[ContentPart] = []
        seen_keys = set()
        for item in inputs:
            if item.get("type") != "file":
                continue
            dedupe_key = item.get("s3Key") or item.get("fileId") or item.get("filename")
            if not dedupe_key or dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            file_part = await self._file_item_to_part(
                canvas_id, node_id, auth_token, item
            )
            if file_part is not None:
                file_parts.append(file_part)
        return file_parts

    async def _file_item_to_part(
        self,
        canvas_id: str,
        node_id: str,
        auth_token: str,
        item: Dict[str, Any],
    ) -> Optional[ContentPart]:
        try:
            presign = await self._backend_presign_download(
                canvas_id, node_id, auth_token, item
            )
        except BackendError as exc:
            log.warning("Presign download failed for %s: %s", item.get("filename"), exc)
            return None

        download_url = presign.get("downloadUrl")
        if not download_url:
            return None

        file_bytes = await asyncio.to_thread(self._download_bytes_from_url, download_url)
        if not file_bytes:
            return None

        filename = presign.get("filename") or item.get("filename") or "input.bin"
        mime_type = presign.get("contentType") or item.get("contentType") or "application/octet-stream"
        creator = getattr(a2a, "create_file_part_from_bytes", None)
        if callable(creator):
            return creator(content_bytes=file_bytes, name=filename, mime_type=mime_type)

        encoded = base64.b64encode(file_bytes).decode("ascii")
        file_content = {"name": filename, "mimeType": mime_type, "bytes": encoded}
        return a2a.create_data_part(data={"type": "file_fallback", "file": file_content})

    async def _within_node_budget(
        self, canvas_id: str, node_id: str, auth_token: str
    ) -> bool:
        children = await self._backend_list_children(canvas_id, node_id, auth_token)
        if len(children) >= self.node_budget_max_children:
            return False

        depth = 0
        current = await self._backend_get_node(canvas_id, node_id, auth_token)
        parent_id = current.get("parentNodeId")
        while parent_id and parent_id != "ROOT":
            depth += 1
            if depth >= self.node_budget_max_depth:
                return False
            current = await self._backend_get_node(canvas_id, parent_id, auth_token)
            parent_id = current.get("parentNodeId")
        return True

    def _resolve_backend_token(self, payload: Dict[str, Any]) -> str:
        if self.backend_auth_mode == "user_token":
            token = payload.get("userToken") or ""
            if token:
                return self._normalize_bearer(token)
            raise BackendError("Missing userToken for backend requests")

        token = self.backend_service_token or ""
        if not token:
            raise BackendError("Missing backend service token")
        return self._normalize_bearer(token)

    def _normalize_bearer(self, token: str) -> str:
        stripped = token.strip()
        if stripped.startswith("Bearer "):
            return stripped
        return "Bearer " + stripped

    def _requires_approval(self, action: str, approval_mode: str) -> bool:
        if approval_mode == "approve_all":
            return True
        if approval_mode == "approve_nodes":
            return action in ["propose_subnode", "complete_node"]
        return False

    def _format_inputs_summary(self, inputs: List[Dict[str, Any]]) -> str:
        lines = ["Inputs summary:"]
        for item in inputs:
            item_type = item.get("type")
            if item_type == "text":
                lines.append(f"- text: {item.get('text', '')}")
            elif item_type == "link":
                lines.append(f"- link: {item.get('url', '')}")
            elif item_type == "file":
                lines.append(f"- file: {item.get('filename', '')}")
            else:
                lines.append(f"- {item_type}: {item}")
        return "\n".join(lines)

    def _download_bytes_from_url(self, url: str) -> bytes:
        req = url_request.Request(url, method="GET")
        with url_request.urlopen(req, timeout=self.backend_timeout_seconds) as response:
            return response.read()

    def _extract_file_bytes(self, file_content: Any) -> bytes:
        raw_bytes = getattr(file_content, "bytes", None)
        if raw_bytes is None and isinstance(file_content, dict):
            raw_bytes = file_content.get("bytes")
        if isinstance(raw_bytes, bytes):
            return raw_bytes
        if isinstance(raw_bytes, str):
            return base64.b64decode(raw_bytes)
        return b""

    def _get_node_for_stream(self, canvas_id: str, node_id: str, auth_token: str) -> Dict[str, Any]:
        if not self.async_loop or not self.async_loop.is_running():
            raise BackendError("Async loop not running")
        future = asyncio.run_coroutine_threadsafe(
            self._backend_get_node(canvas_id, node_id, auth_token),
            self.async_loop,
        )
        return future.result(timeout=self.backend_timeout_seconds)

    def _filter_activity_log(
        self, entries: List[Dict[str, Any]], since: str
    ) -> List[Dict[str, Any]]:
        if not since:
            return entries
        filtered = []
        for entry in entries:
            created_at = entry.get("createdAt", "")
            if created_at and created_at > since:
                filtered.append(entry)
        return filtered

    def _write_stream_event(
        self, handler: BaseHTTPRequestHandler, event: str, payload: Dict[str, Any]
    ) -> None:
        data = json.dumps(payload, ensure_ascii=True)
        message = f"event: {event}\ndata: {data}\n\n"
        handler.wfile.write(message.encode("utf-8"))
        handler.wfile.flush()

    def _write_stream_comment(self, handler: BaseHTTPRequestHandler, comment: str) -> None:
        handler.wfile.write(f": {comment}\n\n".encode("utf-8"))
        handler.wfile.flush()

    def _write_stream_error(self, handler: BaseHTTPRequestHandler, message: str) -> None:
        handler.send_response(400)
        handler.send_header("Content-Type", "application/json")
        handler.end_headers()
        handler.wfile.write(json.dumps({"ok": False, "error": message}).encode("utf-8"))

    def _first_query_value(self, query: Dict[str, List[str]], key: str) -> str:
        values = query.get(key, [])
        if not values:
            return ""
        return values[0]

    def _get_status_message(self, event_data: TaskStatusUpdateEvent) -> Any:
        getter = getattr(a2a, "get_message_from_status_update", None)
        if callable(getter):
            return getter(event_data)
        status = getattr(event_data, "status", None)
        return getattr(status, "message", None)

    def _get_message_parts(self, message: Any) -> List[Any]:
        getter = getattr(a2a, "get_parts_from_message", None)
        if callable(getter):
            return getter(message)
        return getattr(message, "parts", []) or []

    def _get_data_from_part(self, part: DataPart) -> Dict[str, Any]:
        getter = getattr(a2a, "get_data_from_data_part", None)
        if callable(getter):
            data = getter(part)
            return data if isinstance(data, dict) else {}
        data = getattr(part, "data", None)
        return data if isinstance(data, dict) else {}

    def _get_artifact_from_update(self, event_data: TaskArtifactUpdateEvent) -> Any:
        getter = getattr(a2a, "get_artifact_from_artifact_update", None)
        if callable(getter):
            return getter(event_data)
        return getattr(event_data, "artifact", None)

    def _get_artifact_parts(self, artifact: Any) -> List[Any]:
        getter = getattr(a2a, "get_parts_from_artifact", None)
        if callable(getter):
            return getter(artifact)
        return getattr(artifact, "parts", []) or []

    def _get_task_id(self, task_data: Task) -> str:
        getter = getattr(a2a, "get_task_id", None)
        if callable(getter):
            return getter(task_data)
        return getattr(task_data, "id", "") or getattr(task_data, "task_id", "")

    def _get_task_status(self, task_data: Task) -> Any:
        getter = getattr(a2a, "get_task_status", None)
        if callable(getter):
            return getter(task_data)
        status = getattr(task_data, "status", None)
        return getattr(status, "state", None)

    def _get_error_message(self, error_data: JSONRPCError) -> str:
        getter = getattr(a2a, "get_error_message", None)
        if callable(getter):
            return getter(error_data)
        message = getattr(error_data, "message", None)
        return message or str(error_data)

    def _determine_slot_from_filename(self, filename: str) -> str:
        lowered = (filename or "").lower()
        if lowered.startswith("evidence__") or lowered.startswith("evidence-") or lowered.startswith("evidence/"):
            return "evidence"
        return "outputs"

    def _build_log_entry(
        self, entry_type: str, message: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return {
            "logId": str(uuid.uuid4()),
            "type": entry_type,
            "message": message,
            "createdAt": self._utc_now(),
            "data": data,
        }

    def _append_log(self, log_items: List[Dict[str, Any]], entry: Dict[str, Any]) -> List[Dict[str, Any]]:
        updated = list(log_items)
        updated.append(entry)
        return updated

    def _utc_now(self) -> str:
        return datetime.utcnow().isoformat() + "Z"

    def cleanup(self):
        log.info(
            "%s Cleaning up GlassBoxGateway Gateway Component (Pre-Base)...",
            self.log_identifier,
        )
        super().cleanup()
        log.info(
            "%s GlassBoxGateway Gateway Component cleanup finished.",
            self.log_identifier,
        )
