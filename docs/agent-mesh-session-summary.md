# Agent Mesh Session Summary

This document captures the implementation and deployment work done to get the GlassBox
gateway + Solace Agent Mesh running end-to-end, along with current behavior, known gaps,
and next steps.

## High-Level Outcome

- Gateway and backend are working end-to-end: the test flow can create a canvas, create
  a node, assign the agent, execute the node, and receive a successful response.
- Anthropic direct API is configured for LLM calls (Opus 4.5 for planning, Sonnet 4.5
  for tool/general/report).
- Agent produces evidence artifacts locally (filesystem). These are not yet uploaded
  to S3 automatically.
- Streaming (SSE) works via the gateway; activity logs show execution progress.

## Architecture Overview (Current State)

- **Frontend (future)**:
  - Calls backend REST endpoints for canvases/nodes.
  - Uses SSE from gateway for streaming updates.
- **Backend (AWS Lambda + API Gateway via SAM)**:
  - Handles CRUD for canvases/nodes.
  - Calls gateway on execute/approve actions using the `GatewayApiBaseUrl` parameter.
  - Issues presigned URLs for file uploads (S3).
- **Gateway (EC2)**:
  - `solace-agent-mesh run` launches the GlassBox gateway + agents.
  - Receives execution requests from backend and sends tasks into the Solace broker.
  - Streams activity logs and status updates via SSE.
- **Broker (Solace PubSub+ Docker)**:
  - Local broker running in Docker on EC2.
  - Handles A2A routing between gateway and agents.
- **Agents**:
  - Main orchestrator + worker agent.
  - LLM calls via Anthropic direct API (LiteLLM wrapper).
  - Evidence artifacts created by agent (filesystem artifact service).

## LLM Configuration (Anthropic Direct)

In `agent-mesh/.env`:

- `LLM_SERVICE_ENDPOINT="https://api.anthropic.com"`
- `LLM_SERVICE_API_KEY="<ANTHROPIC_KEY>"`
- `LLM_SERVICE_PLANNING_MODEL_NAME="anthropic/claude-opus-4-5-20251101"`
- `LLM_SERVICE_GENERAL_MODEL_NAME="anthropic/claude-sonnet-4-5-20250929"`
- `LLM_REPORT_MODEL_NAME="anthropic/claude-sonnet-4-5-20250929"`

In `agent-mesh/configs/shared_config.yaml`:

- The `planning`, `general`, and `report_gen` models reference these env vars.
- `cache_strategy: "5m"` is enabled for LiteLLM.

## Evidence and Artifacts

Current behavior:

- Artifacts are **written to filesystem** by the agent mesh artifact service:
  - Config: `shared_config.yaml` -> `artifact_service` uses `type: "filesystem"`
  - Default base path: `./artifacts` (relative to `agent-mesh/`)
- Evidence artifacts (e.g., `evidence__vendor_x_security_analysis.md`) are created and
  saved successfully.
- There is a **non-fatal error** when loading artifact content:
  - `expected str, bytes or os.PathLike object, not NoneType`
  - This appears to be due to a missing user ID when building the artifact path.

Answer to "are artifacts uploaded to S3?"

- **Not currently.** The agent mesh artifacts are local filesystem artifacts only.
- S3 is used in the backend for file uploads (presign and complete flows), but agent
  artifacts are not auto-pushed to S3 yet.

## Did the Agent Generate Sub-Nodes?

- In the test flow runs, **no automatic sub-nodes were created**.
- The tool exists for agent-created nodes, but it was not invoked in the latest
  successful runs.

## How to View Logs

Gateway + agent mesh logs (EC2):

- `tail -f /opt/glassbox/uOttaHacks2026/agent-mesh/glass-box-orchestrator.log`
- `tail -f /opt/glassbox/uOttaHacks2026/agent-mesh/*.log`

Broker logs (Docker):

- `sudo docker logs -f solace`

Backend Lambda logs (CloudWatch):

- `aws logs tail /aws/lambda/GlassBoxExecuteNode --since 10m --region us-east-1`

SSE stream (live execution):

- `curl -N "http://<gateway-ip>:8001/stream?canvasId=<id>&nodeId=<id>" -H "Authorization: Bearer <token>"`

## Deployment Process (Deep Review)

### Backend (SAM + API Gateway)

1. `sam build` (as needed after code changes).
2. `sam deploy` with parameters:
   - `GatewayApiBaseUrl` set to `http://<EC2_PUBLIC_IP>:8001`
3. Verify output in `backend/samconfig.toml` or CloudFormation stack parameters.

Notes:
- `GatewayApiBaseUrl` must point to the EC2 gateway host and port.
- Cognito tokens expire frequently; refresh for each test run.

### Gateway + Agents (EC2)

1. Ensure broker is running (Docker):
   - `sudo docker run -d --name solace -p 8080:8080 -p 55555:55555 -p 8008:8008 -p 55443:55443 solace/solace-pubsub-standard:latest`
2. Set `.env` in `agent-mesh/`:
   - LLM provider/model values
   - `GLASSBOX_API_BASE_URL`
   - `GLASSBOX_SERVICE_TOKEN`
   - Broker connection values
3. Start agent mesh:
   - `solace-agent-mesh run`

### Broker Configuration

The gateway uses:

- `SOLACE_BROKER_URL="ws://localhost:8008"`
- `SOLACE_BROKER_USERNAME="default"`
- `SOLACE_BROKER_PASSWORD="default"`
- `SOLACE_BROKER_VPN="default"`

### Auth Tokens

Backend scripts require a fresh Cognito token:

- Use `aws cognito-idp initiate-auth` to fetch a new token.
- Export token for testing:
  - `export AUTH_TOKEN="Bearer <token>"`

## Testing Flow (Known Good)

Use:

- `python backend/scripts/test_flow.py`

Expected:

- Canvas created.
- Node created and assigned to `GlassBoxWorker`.
- Execute returns a task ID.
- SSE stream shows activity logs and a final successful response.

## Known Gaps / Cleanup Items

- **Artifact load error**: missing user ID when resolving artifact paths.
- **S3 artifact upload**: local artifacts are not auto-pushed to S3.
- **Frontend integration**: not yet wired to live canvas/node views.

## Next Steps

1. Fix artifact load error:
   - Ensure user identity propagates to artifact service.
2. Add S3 artifact upload:
   - Persist agent artifacts into S3 and attach URLs to node evidence.
3. Frontend integration:
   - Wire REST calls (create canvas/node, assign, execute, approve).
   - Consume SSE stream for live logs.
4. Deployment hardening:
   - Add systemd service to auto-restart gateway.
   - Log rotation for `agent-mesh/*.log`.

## How to Swap Models (Future Fast Path)

Edit `agent-mesh/.env`:

- `LLM_SERVICE_ENDPOINT`
- `LLM_SERVICE_API_KEY`
- `LLM_SERVICE_PLANNING_MODEL_NAME`
- `LLM_SERVICE_GENERAL_MODEL_NAME`
- `LLM_REPORT_MODEL_NAME`

Restart the mesh to apply:

- `solace-agent-mesh run`
