# Glass Box Backend

AWS SAM-based backend for the Glass Box collaborative canvas application.

## Architecture

- **API Gateway HTTP API** - REST API with JWT authentication
- **Cognito User Pool** - User authentication (email/password)
- **DynamoDB** - Two tables:
  - `CanvasTable` - Canvas metadata and membership
  - `NodesTable` - Node data with GSI for parent queries
- **S3** - Private bucket for file storage
- **Lambda Functions** - Python 3.11 handlers for all endpoints

## Prerequisites

- AWS CLI configured with appropriate credentials
- AWS SAM CLI installed (`sam --version`)
- Python 3.11
- AWS region: `us-east-1` (configurable in template)

## Deployment

### 1. Build the application

```bash
cd backend
sam build
```

### 2. Deploy to AWS

```bash
sam deploy --guided
```

The `--guided` flag will prompt you for:
- Stack name
- AWS Region
- Parameter overrides
- Confirmation of changes

For subsequent deployments:

```bash
sam deploy
```

### 3. Get Output Values

After deployment, retrieve important values:

```bash
aws cloudformation describe-stacks \
  --stack-name <stack-name> \
  --query 'Stacks[0].Outputs'
```

Key outputs:
- `ApiUrl` - API Gateway endpoint URL
- `UserPoolId` - Cognito User Pool ID
- `UserPoolClientId` - Cognito User Pool Client ID
- `FilesBucketName` - S3 bucket name for files

## API Endpoints

All endpoints require JWT authentication via Cognito (except health check if implemented).

### Base URL
Use the `ApiUrl` from stack outputs.

### Authentication
Include JWT token in `Authorization` header:
```
Authorization: Bearer <jwt-token>
```

### Endpoints

#### Canvas Management

- `POST /canvases` - Create a new canvas
- `POST /canvases/join` - Join a canvas using join code
- `GET /canvases` - List all canvases for current user

#### Node Management

- `GET /nodes?canvasId={id}&parentNodeId={id}&updatedSince={iso8601}` - List nodes
- `GET /nodes?canvasId={id}&updatedSince={iso8601}&includeAll=true` - List all nodes updated since
- `GET /nodes/{nodeId}?canvasId={id}` - Get a single node
- `POST /nodes` - Create a new node
- `PATCH /nodes/{nodeId}` - Update a node
- `DELETE /nodes/{nodeId}?canvasId={id}` - Delete node and descendants
- `POST /nodes/{nodeId}/execute` - Trigger agent execution via gateway
- `POST /nodes/{nodeId}/approve` - Approve or reject a pending agent action

#### File Management

- `POST /files/presign` - Get presigned URL for file upload
- `POST /files/complete` - Complete file upload and attach to node
- `POST /files/presign-download` - Get presigned URL for file download

## Response Format

### Success Response
```json
{
  "ok": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

## Data Model

### Canvas
- `canvasId` (UUID)
- `name` (string)
- `joinCode` (8-10 char alphanumeric)
- `ownerSub` (Cognito user ID)
- `createdAt` (ISO8601)

### Node
- `nodeId` (UUID)
- `canvasId` (UUID)
- `parentNodeId` ("ROOT" or UUID)
- `title` (string)
- `description` (string)
- `inputs` (array of item objects)
- `outputs` (array of item objects)
- `evidence` (array of item objects)
- `status` ("draft" | "ready" | "in_progress" | "blocked" | "completed" | "failed")
- `approvalMode` ("auto" | "approve_nodes" | "approve_all")
- `assignedTo` (object with `type` and `id`)
- `approvalRequests` (array of approval request objects)
- `activityLog` (array of log entries)
- `activeTaskId` (string, task id for current execution)
- `authorSub` (Cognito user ID)
- `createdAt` (ISO8601)
- `updatedAt` (ISO8601)

Note: When `status` is set to `completed` and `assignedTo.type` is `agent`, evidence must be non-empty.

### Item Object
- `type` - "text" | "link" | "file" | "node"
- For type="text": `text`
- For type="link": `url`
- For type="file": `fileId`, `s3Key`, `filename`, `contentType`
- For type="node": `nodeId`, optional `include` ("outputs" | "evidence" | "all")

### Approval Request Object
- `approvalId` (UUID)
- `type` ("propose_subnode" | "add_output" | "add_evidence" | "complete_node")
- `status` ("pending" | "approved" | "rejected" | "applied")
- `requestedAt` (ISO8601)
- `requestedBy` (object with `type` and `id`)
- `payload` (object)
- `rationale` (string, optional)

### Activity Log Entry
- `logId` (UUID)
- `type` ("status" | "action" | "approval" | "artifact" | "error")
- `message` (string)
- `createdAt` (ISO8601)
- `data` (object)

## Local Development

### Test Lambda Functions Locally

```bash
sam local start-api
```

This starts a local API Gateway on `http://localhost:3000`.

### Invoke Individual Functions

```bash
sam local invoke CreateCanvasFunction --event events/create-canvas.json
```

## Project Structure

```
backend/
├── template.yaml          # SAM template
├── requirements.txt       # Python dependencies
├── src/
│   ├── common/           # Shared utilities
│   │   ├── auth.py       # Authentication helpers
│   │   ├── dynamodb.py   # DynamoDB operations
│   │   ├── response.py   # Response formatting
│   │   ├── s3.py         # S3 operations
│   │   ├── validation.py # Input validation
│   │   └── logging.py    # Logging setup
│   └── handlers/         # Lambda handlers
│       ├── canvases.py   # Canvas endpoints
│       ├── nodes.py      # Node endpoints
│       └── files.py      # File endpoints
└── README.md
```

## Security Notes

- All endpoints require JWT authentication
- S3 bucket has public access blocked
- Presigned URLs expire after 1 hour
- DynamoDB uses least-privilege IAM policies
- Cascade delete removes S3 objects when nodes are deleted

## Troubleshooting

### Check Lambda Logs

```bash
sam logs -n CreateCanvasFunction --stack-name <stack-name> --tail
```

### Verify DynamoDB Tables

```bash
aws dynamodb list-tables
aws dynamodb describe-table --table-name GlassBoxCanvasTable
```

### Test Cognito Authentication

Use AWS Cognito SDK or AWS CLI to create test users:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username test@example.com \
  --user-attributes Name=email,Value=test@example.com
```
