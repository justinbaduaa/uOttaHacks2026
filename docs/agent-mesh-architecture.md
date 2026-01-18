# Glass Box Agent Mesh Architecture (v1 Implementation)

## Goals and Constraints
- Humans define nodes and inputs before execution; agents operate on those nodes.
- Every agent-assigned node must have evidence before completion.
- Prevent node overkill through explicit budgets and approval gates.
- Keep all agent actions auditable and replayable through explicit evidence and logs.
- Self-hosted deployment; avoid tight coupling between backend and agent runtime.

## Core Decisions (Locked for v1)
1. **Evidence schema is unified.**
   Evidence is an array of the same item objects used for inputs/outputs:
   - `type: text | link | file | node`
   - Evidence is required **only** when a node is agent-assigned and is marked `completed`.

2. **Humans create nodes; agents do not create top-level nodes.**
   Agents may propose sub-nodes only when necessary and only within the budget provided by the gateway.

3. **Node references are first-class inputs.**
   Inputs may include `{ type: "node", nodeId, include }` items. The gateway resolves these and injects the referenced node outputs/evidence into the agent context.

4. **Agents do not write to the backend directly.**
   Agents produce artifacts and structured action intents; the gateway enforces approvals and applies changes to the backend.

5. **Approval modes are explicit and enforced by the gateway.**
   - `auto`: no approvals; agent executes.
   - `approve_nodes`: approvals required for new sub-nodes and completion.
   - `approve_all`: approvals required for every tool-action that mutates state.

6. **Agent actions are structured.**
   Agents emit `DataPart` action intents; the gateway is the only writer to backend state.

## System Components
- **Glass Box Backend (AWS SAM)**: source of truth for canvases, nodes, inputs/outputs/evidence, and S3 files.
- **Solace Event Broker**: A2A message backbone for agent orchestration and status updates.
- **Agent Hosts**: Orchestrator agent + worker agents (Solace ADK runtime).
- **GlassBoxGateway**: custom gateway bridging A2A to the backend and UI.
- **UI**: Electron client that submits assignments and receives streaming updates.

## Execution Flow (Human-Defined Task)
1. **Human defines node + inputs** in the UI and selects approval mode.
2. **Assign to agent + Execute**:
   - Backend stores `assignedTo`, `approvalMode`, and `status=ready`.
   - Backend calls the gateway `POST /execute` to start the task.
3. **Gateway creates A2A task**:
   - Uses A2A request topic `{namespace}/a2a/v1/agent/request/{target_agent_name}`.
   - Includes node context, inputs, and resolved node references.
4. **Agent runs**:
   - Uses built-in artifact tools to create evidence and outputs.
   - Emits status updates before tool actions.
5. **Gateway enforces approvals**:
   - If approvals are needed, sends approval requests to UI and waits.
6. **Gateway writes to backend**:
   - Uploads artifacts to S3 via `POST /files/presign` -> upload -> `POST /files/complete`.
   - Updates node `evidence`, `outputs`, `status`, and `activityLog`.
7. **UI receives streaming updates**:
   - Backend re-emits gateway status updates via SSE to the UI.

## Evidence + Artifact Strategy
- Agents use built-in artifact tools (`/api/artifacts/create`, `list`, `load`, `signal_return`).
- Gateway can access artifact content via context services (load/list artifacts).
- We store long-lived artifacts in S3 by translating artifacts into backend file items.
- Evidence is attached as `type: file` items (S3 keys) or `type: text` notes.
- Artifact filename prefixes:
  - `evidence__*` attaches to evidence.
  - default attaches to outputs.

## Node Reference Resolution
When a node input includes `{ type: "node" }`:
1. Gateway fetches node by `GET /nodes/{nodeId}?canvasId=...`.
2. If `include=outputs`, inject only outputs.
3. If `include=evidence`, inject only evidence.
4. If `include=all`, inject both.
5. Injected items are included in the agent context (DataPart + FilePart).

## Approval Modes (Gateway Policy)
- `auto`: skip approvals and stream status updates only.
- `approve_nodes`: approvals needed for proposed subnodes and completion.
- `approve_all`: approvals required before any tool-backed mutation (files, evidence, outputs, or status).

## Approval Lifecycle
- Gateway creates `approvalRequests[]` entries on the node when approvals are required.
- Humans resolve approvals via `POST /nodes/{nodeId}/approve`.
- Gateway polls pending approvals and applies approved actions.
- Applied approvals are marked `status=applied` for traceability.

## Auth Strategy (v1)
- UI uses Cognito JWT to authenticate with backend.
- Gateway uses `backend_auth_mode`:
  - `service_token`: uses a service token for backend requests.
  - `user_token`: passes through the user JWT for backend writes.
- User identity from A2A messages is preserved in logs and node `authorSub`.

## S3 Upload Flow (Gateway)
1. Agent produces artifacts (files, reports, etc.).
2. Gateway calls `POST /files/presign` to get upload URL and `s3Key`.
3. Gateway uploads artifact content to S3 using the presigned URL.
4. Gateway calls `POST /files/complete` to attach the file to node outputs/evidence.

## Structured Agent Actions (DataPart)
Agents emit DataParts with:
```json
{
  "type": "glassbox_action",
  "action": "propose_subnode | add_output | add_evidence | complete_node",
  "payload": { "..." : "..." },
  "rationale": "why this action is needed (required when approval is needed)"
}
```
The gateway is the only component that mutates backend state.

## Gateway HTTP API
- `POST /execute`
  - Body: `{ "canvasId": "...", "nodeId": "...", "userToken": "Bearer ...", "approvalMode": "..." }`
  - Optional header: `X-Glassbox-Token` shared secret.
  - Response: `{ taskId, approvalMode }`

## Activity Log
- Node field `activityLog[]` records status updates, actions, approvals, artifacts, and errors.
- Used for streaming and auditability.

## Deployment Model
- **Local dev**: `SOLACE_DEV_MODE=true` and `sam run` inside `agent-mesh/`.
- **Self-hosted**:
  - Broker: Solace PubSub+ container or hosted broker.
  - Agent hosts + gateway on EC2 (containerized).
  - Backend remains AWS SAM (API + DynamoDB + S3).

## Scaffold Artifacts Created
- `agent-mesh/configs/agents/main_orchestrator.yaml`
- `agent-mesh/configs/agents/glass_box_worker_agent.yaml`
- `agent-mesh/configs/gateways/glass_box_gateway_config.yaml`
- `agent-mesh/src/glass_box_gateway/*`
- `agent-mesh/configs/shared_config.yaml`
- `agent-mesh/.env`

## Gateway Config Keys (Initial)
- `gateway_host`
- `gateway_port`
- `gateway_shared_secret`
- `backend_api_base_url`
- `backend_auth_mode`
- `backend_service_token`
- `backend_timeout_seconds`
- `approval_mode_default`
- `node_budget_max_children`
- `node_budget_max_depth`
- `artifact_upload_mode`
- `approval_poll_interval_seconds`

## Next Build Steps
- Add SSE/WebSocket streaming from backend to UI.
- Add artifact download/presign endpoint for node input files.
- Expand approval UX in the Electron client.
