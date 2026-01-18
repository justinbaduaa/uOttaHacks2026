# Example Flow: HILT Agent Task with RFI + Yellowcake

## Scenario
Procurement receives an RFI titled "Vendor X Security Review". The goal is to
produce a short security summary with supporting evidence and create a child
subtask if a deeper policy review is needed.

## Inputs (RFI)
- `RFI-2026-0147.pdf` (file input)
- Text input: "Summarize Vendor X security posture and list any gaps."
- Link input: "https://vendorx.com/security"

In this system, an RFI is just a structured input package (text/link/file) that
the agent must answer. The response and supporting files are attached as evidence
on the node.

## Human-In-The-Loop Mode
We set `approvalMode=approve_nodes`, which means:
- Subnode creation requires approval.
- Completion requires approval.
- Adding outputs/evidence is automatic.

## Step-by-Step Flow
1) Human creates the node (UI or API).
```json
{
  "canvasId": "<canvas-id>",
  "title": "RFI: Vendor X Security Review",
  "description": "Summarize Vendor X security posture for procurement.",
  "inputs": [
    { "type": "text", "text": "Summarize Vendor X security posture and list any gaps." },
    { "type": "link", "url": "https://vendorx.com/security" },
    { "type": "file", "fileId": "<file-id>", "s3Key": "canvases/.../RFI-2026-0147.pdf", "filename": "RFI-2026-0147.pdf", "contentType": "application/pdf" }
  ],
  "status": "draft"
}
```

2) Human assigns the agent and marks node ready.
```json
{
  "canvasId": "<canvas-id>",
  "assignedTo": { "type": "agent", "id": "GlassBoxWorker" },
  "approvalMode": "approve_nodes",
  "status": "ready"
}
```

3) Human clicks Execute.
- Backend calls the gateway `POST /execute`.
- Gateway resolves inputs:
  - File inputs are fetched from S3 via `POST /files/presign-download`.
  - File bytes are passed to the agent as `FilePart`s.
  - Text/link inputs are included in a `DataPart` context.

4) Agent receives the task and uses Yellowcake.
Example tool call from the agent:
```json
{
  "tool": "yellowcake_extract",
  "args": {
    "url": "https://vendorx.com/security",
    "prompt": "Extract security claims, certifications, and any compliance statements."
  }
}
```
The tool returns the final `complete` payload, which the agent uses in its analysis.

5) Agent proposes a deeper subtask (requires approval).
```json
{
  "type": "glassbox_action",
  "action": "propose_subnode",
  "payload": {
    "title": "Review Vendor X privacy policy",
    "description": "Check DPA, data retention, and breach notification clauses.",
    "inputs": [
      { "type": "link", "url": "https://vendorx.com/privacy" }
    ],
    "assignedTo": { "type": "agent", "id": "GlassBoxWorker" },
    "status": "ready"
  },
  "rationale": "Privacy policy review is needed for completeness."
}
```
Gateway creates an approval request on the node.

6) Human approves the subnode.
- UI calls `POST /nodes/{nodeId}/approve` with the approvalId.
- Gateway applies the action and creates the child node.

7) Agent delivers outputs + evidence.
- Outputs (summary report) are stored as artifacts and uploaded to S3.
- Evidence notes are attached to `node.evidence[]`:
```json
{
  "type": "glassbox_action",
  "action": "add_evidence",
  "payload": {
    "item": { "type": "text", "text": "Vendor X claims SOC2 Type II and ISO27001 (from Yellowcake)." }
  }
}
```

8) Agent requests completion (requires approval).
```json
{
  "type": "glassbox_action",
  "action": "complete_node",
  "payload": { "summary": "Summary completed with evidence attached." },
  "rationale": "All requested inputs processed and evidence attached."
}
```
Human approves, gateway marks node `completed`.

## What Gets Produced
- **Outputs**: e.g. `SecurityReview_VendorX.md` (S3 file in `node.outputs[]`).
- **Evidence**:
  - `RFI-2026-0147.pdf` (original RFI file, if placed in evidence).
  - Yellowcake findings as text evidence.
  - Any supporting files with `evidence__` prefix.
- **Activity Log**:
  - Status updates from the agent.
  - Approval request entries and decisions.
  - Artifact upload notes.

## Ties to Custom Code
- `glassbox_action` DataParts are handled in the gateway (`agent-mesh/src/glass_box_gateway/component.py`).
- File inputs are resolved via `/files/presign-download` and injected as `FilePart`s.
- Artifacts are uploaded to S3 and attached to `outputs[]` or `evidence[]`.
- SSE stream `GET /stream` emits `activityLog` entries for realtime status.
