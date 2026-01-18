# Test Setup Guide (Gateway + Backend + Agents)

This guide assumes you will run the backend (AWS SAM), the Solace broker, and
the Agent Mesh gateway/agents locally, then test the end-to-end flow.

## 1) Backend (AWS SAM)
1. Create a Python virtual environment and install dependencies:
```bash
python -m venv .venv
source .venv/bin/activate
```
Install dependencies with either `pip` or `uv`:
```bash
pip install -r backend/requirements.txt
# or, if you prefer uv
pip install uv
uv pip install -r backend/requirements.txt
```
2. Build and deploy:
```bash
cd backend
sam build
sam deploy --guided
```
3. Capture the outputs (API URL, UserPoolId, UserPoolClientId, FilesBucketName).

## 2) Authentication
You need a Cognito JWT for API calls:
- Create a user in the Cognito User Pool.
- Authenticate and obtain an `id_token` or `access_token`.
- Use it as `AUTH_TOKEN` for scripts (Bearer token is accepted).

## 3) Agent Mesh + Gateway
1. Create a Python virtual environment and install Solace Agent Mesh:
```bash
python -m venv .venv
source .venv/bin/activate
```
Install dependencies with either `pip` or `uv`:
```bash
pip install solace-agent-mesh~=1.13.6
# or, if you prefer uv
pip install uv
uv pip install solace-agent-mesh~=1.13.6
```
2. Configure `agent-mesh/.env`:
```
GLASSBOX_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com"
GLASSBOX_BACKEND_AUTH_MODE="service_token"
GLASSBOX_SERVICE_TOKEN="<Bearer token>"
GLASSBOX_GATEWAY_SHARED_SECRET="<optional shared secret>"
YELLOWCAKE_API_KEY="<yellowcake key>"
```
3. Run Agent Mesh (from `agent-mesh/`):
```bash
solace-agent-mesh run
```
If AWS SAM is installed and `sam` points to AWS, use `solace-agent-mesh run`
explicitly.

## 4) Create Test Data
Use the backend scripts (require `API_BASE_URL` and `AUTH_TOKEN`):
```bash
export API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com"
export AUTH_TOKEN="<Bearer token>"
python backend/scripts/create_canvas.py --name "Test Canvas"
```

Or run the scripted flow:
```bash
python backend/scripts/test_flow.py
```

Create a node:
```bash
python backend/scripts/create_node.py \
  --canvas-id "<canvas-id>" \
  --title "RFI: Vendor X Security Review" \
  --description "Summarize Vendor X security posture."
```

Assign the agent and mark ready:
```bash
python backend/scripts/update_node.py \
  --canvas-id "<canvas-id>" \
  --node-id "<node-id>" \
  --body-json '{"assignedTo":{"type":"agent","id":"GlassBoxWorker"},"approvalMode":"approve_nodes","status":"ready"}'
```

Execute:
```bash
python backend/scripts/execute_node.py --canvas-id "<canvas-id>" --node-id "<node-id>"
```

## 5) Optional: Add File Input (RFI PDF)
1. Presign and upload:
```bash
python backend/scripts/presign_file.py --canvas-id "<canvas-id>" --node-id "<node-id>" --slot inputs --filename "RFI-2026-0147.pdf" --content-type "application/pdf"
```
2. Upload to the returned `uploadUrl` (use curl or any HTTP client).
3. Complete the file upload:
```bash
python backend/scripts/complete_file.py --canvas-id "<canvas-id>" --node-id "<node-id>" --slot inputs --file-id "<file-id>" --s3-key "<s3-key>" --filename "RFI-2026-0147.pdf" --content-type "application/pdf"
```

## 6) Stream Activity Log (SSE)
```bash
curl -N "http://127.0.0.1:8001/stream?canvasId=<canvas-id>&nodeId=<node-id>" \
  -H "Authorization: Bearer <token>"
```

## 7) Approvals (HILT)
1. Fetch the node and read `approvalRequests[]`:
```bash
python backend/scripts/get_node.py --canvas-id "<canvas-id>" --node-id "<node-id>"
```
2. Approve or reject:
```bash
python backend/scripts/approve_node_action.py \
  --canvas-id "<canvas-id>" \
  --node-id "<node-id>" \
  --approval-id "<approval-id>" \
  --decision approved
```

## 8) Validate Outputs/Evidence
Use `get_node.py` to confirm `outputs[]`, `evidence[]`, and `activityLog[]` are populated.

## Expected Results
- A2A task submitted and processed by the agent.
- Outputs and evidence attached to the node (files stored in S3).
- Activity log streaming and approval gating work as expected.
