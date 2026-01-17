# Backend Source Code Architecture

This document explains the structure and organization of the backend source code, how modules interact, and the purpose of each component.

## Overview

The backend is an AWS SAM-based serverless application built with Python 3.13. It uses AWS Lambda functions to handle API requests, DynamoDB for data storage, S3 for file storage, and Cognito for authentication.

## Directory Structure

```
backend/src/
├── handlers/          # Lambda function handlers (API endpoints)
│   ├── canvases.py    # Canvas management endpoints
│   ├── nodes.py       # Node management endpoints
│   └── files.py       # File upload/download endpoints
└── lib/               # Shared utility modules
    ├── logging.py     # Logging & Sentry initialization
    ├── auth.py        # Authentication utilities
    ├── response.py    # Standardized API responses
    ├── dynamodb.py    # DynamoDB operations
    ├── s3.py          # S3 operations
    └── validation.py  # Input validation utilities
```

## Module Interactions

### Request Flow

```
API Gateway → Lambda Handler → [Auth Check] → [Validation] → [Business Logic] → [Database Operations] → Response
```

Each handler follows this pattern:
1. **Authentication** - Extract and verify user identity from JWT token
2. **Validation** - Validate request parameters and body
3. **Authorization** - Check permissions (canvas membership)
4. **Business Logic** - Process the request
5. **Database Operations** - Read/write to DynamoDB or S3
6. **Response** - Return standardized response format

### Dependency Graph

```
handlers/*
    ↓
lib/logging.py (imported first - initializes Sentry)
    ↓
lib/auth.py → lib/response.py
    ↓
lib/validation.py → lib/response.py
    ↓
lib/dynamodb.py → lib/response.py
    ↓
lib/s3.py → lib/response.py
```

## Module Details

### `lib/logging.py` - Logging & Error Tracking

**Purpose**: Centralized logging configuration and Sentry SDK initialization.

**Key Features**:
- Configures Python logging with CloudWatch-compatible format
- Initializes Sentry SDK with AWS Lambda integration
- Provides `get_logger()` function for creating named loggers

**Why it's imported first**: Sentry initialization runs at module import time, ensuring error tracking is active before any handler code executes. All handlers import from `lib.logging`, guaranteeing Sentry is initialized for every Lambda function.

**Key Functions**:
- `get_logger(name: str = None) -> logging.Logger` - Get a logger instance

---

### `lib/auth.py` - Authentication & Authorization

**Purpose**: Extract and validate user identity from API Gateway JWT tokens.

**Key Functions**:
- `extract_user_sub(event: Dict) -> Optional[str]` - Extract user ID (sub claim) from JWT
- `require_auth(event: Dict) -> tuple` - Require authentication, returns `(user_sub, None)` or `(None, error_response)`

**Usage Pattern**:
```python
user_sub, auth_error = require_auth(event)
if auth_error:
    return auth_error
```

**How it works**: 
- Parses JWT claims from `event['requestContext']['authorizer']['jwt']['claims']`
- Returns standardized error response if authentication fails

---

### `lib/response.py` - Standardized API Responses

**Purpose**: Create consistent API response formats for success and error cases.

**Key Functions**:
- `success_response(data: Any, status_code: int = 200)` - Create success response
- `error_response(code: str, message: str, details: Any = None, status_code: int = 400)` - Create error response
- `internal_error_response(message: str = "Internal server error")` - Create 500 error response

**Response Format**:
- **Success**: `{"ok": True, "data": {...}}`
- **Error**: `{"ok": False, "error": {"code": "...", "message": "...", "details": ...}}`

**Why it matters**: Ensures all endpoints return consistent response structures with proper CORS headers and status codes.

---

### `lib/validation.py` - Input Validation

**Purpose**: Validate and parse request inputs (body, query parameters, IDs).

**Key Functions**:
- `parse_body(event: Dict) -> tuple` - Parse JSON request body
- `parse_query_params(event: Dict) -> Dict` - Parse query string parameters
- `validate_canvas_id(canvas_id: str) -> tuple` - Validate UUID format for canvas IDs
- `validate_node_id(node_id: str) -> tuple` - Validate UUID format for node IDs
- `validate_iso8601(timestamp: str) -> tuple` - Validate ISO8601 timestamp format
- `validate_file_slot(slot: str) -> tuple` - Validate file slot is "inputs" or "outputs"
- `validate_file_item(item: Dict) -> tuple` - Validate file item structure
- `validate_inputs_outputs(items: List[Dict]) -> tuple` - Validate inputs/outputs arrays

**Usage Pattern**:
```python
body, parse_error = parse_body(event)
if parse_error:
    return parse_error

valid, error_msg = validate_canvas_id(canvas_id)
if not valid:
    return error_response(code="INVALID_REQUEST", message=error_msg)
```

**Why it matters**: Centralizes validation logic, ensures data integrity, and provides clear error messages.

---

### `lib/dynamodb.py` - Database Operations

**Purpose**: Abstraction layer for all DynamoDB operations.

**Key Features**:
- Manages connections to CanvasTable and NodesTable
- Implements complex queries (GSI lookups, membership checks)
- Handles data transformations between DynamoDB format and API format

**Key Functions**:

**Canvas Operations**:
- `get_canvas_table()` - Get CanvasTable resource
- `get_canvas_meta(canvas_id: str) -> Optional[Dict]` - Get canvas metadata
- `check_membership(canvas_id: str, user_sub: str) -> bool` - Check if user is canvas member
- `require_membership(canvas_id: str, user_sub: str) -> tuple` - Require membership, returns error if not member
- `list_canvases_for_user(user_sub: str) -> List[Dict]` - List all canvases for a user
- `find_canvas_by_join_code(join_code: str) -> Optional[Dict]` - Find canvas by join code

**Node Operations**:
- `get_nodes_table()` - Get NodesTable resource
- `get_node(canvas_id: str, node_id: str) -> Optional[Dict]` - Get single node
- `query_nodes_by_parent(canvas_id: str, parent_node_id: str, updated_since: str = None) -> List[Dict]` - Query nodes by parent using GSI1
- `collect_subtree_nodes(canvas_id: str, root_node_id: str) -> List[str]` - Collect all node IDs in subtree (BFS traversal)
- `batch_delete_nodes(canvas_id: str, node_ids: List[str]) -> int` - Delete multiple nodes in batches

**Data Model**:

**CanvasTable** (PK/SK design):
- `CANVAS#{canvasId} / META` - Canvas metadata
- `CANVAS#{canvasId} / MEMBER#{userSub}` - Membership records
- `USER#{userSub} / CANVAS#{canvasId}` - User's canvas list (denormalized)

**NodesTable** (PK/SK + GSI1):
- Primary Key: `CANVAS#{canvasId} / NODE#{nodeId}`
- GSI1: `CANVAS#{canvasId}#PARENT#{parentNodeId} / UPDATED#{timestamp}#NODE#{nodeId}` - Enables parent-child queries

---

### `lib/s3.py` - File Storage Operations

**Purpose**: Handle S3 operations for file uploads/downloads.

**Key Functions**:
- `generate_presigned_put_url(s3_key: str, content_type: str, expires_in: int = 3600) -> Optional[str]` - Generate presigned URL for upload
- `generate_presigned_get_url(s3_key: str, expires_in: int = 3600) -> Optional[str]` - Generate presigned URL for download
- `extract_file_s3_keys_from_nodes(nodes: List[Dict]) -> List[str]` - Extract S3 keys from node file references
- `batch_delete_s3_objects(s3_keys: List[str]) -> int` - Delete multiple S3 objects in batches

**File Storage Pattern**:
- S3 Key Format: `canvases/{canvasId}/nodes/{nodeId}/{fileId}/{filename}`
- Files are referenced in nodes via `inputs` or `outputs` arrays with type "file"

**Why presigned URLs**: Clients upload directly to S3 without going through Lambda, reducing load and enabling large file uploads.

---

### `handlers/canvases.py` - Canvas Management

**Purpose**: Handle canvas creation, joining, and listing.

**Endpoints**:
- `POST /canvases` - `create_canvas()` - Create a new canvas
- `POST /canvases/join` - `join_canvas()` - Join a canvas using join code
- `GET /canvases` - `list_canvases()` - List all canvases for current user

**Key Operations**:
1. **Create Canvas**: 
   - Generates UUID for canvas ID
   - Generates random 8-character join code
   - Creates 3 DynamoDB records (metadata, membership, user listing)

2. **Join Canvas**:
   - Finds canvas by join code (scan operation)
   - Checks existing membership
   - Adds membership records if new member

3. **List Canvases**:
   - Queries `USER#{userSub}` to get all user's canvases

**Dependencies**:
- Uses `lib.auth` for authentication
- Uses `lib.dynamodb` for database operations
- Uses `lib.validation` for input validation
- Uses `lib.response` for standardized responses

---

### `handlers/nodes.py` - Node Management

**Purpose**: Handle node CRUD operations and hierarchical queries.

**Endpoints**:
- `GET /nodes` - `get_nodes()` - List nodes (filtered by parent and updatedSince)
- `POST /nodes` - `create_node()` - Create a new node
- `PATCH /nodes/{nodeId}` - `update_node()` - Update an existing node
- `DELETE /nodes/{nodeId}` - `delete_node()` - Delete node and all descendants (cascade)

**Key Operations**:
1. **Get Nodes**: 
   - Uses GSI1 to query children of a parent node
   - Supports `updatedSince` filter for incremental sync
   - Returns nodes in API format

2. **Create Node**:
   - Validates inputs/outputs arrays
   - Creates node with GSI1 keys for parent queries
   - Sets `parentNodeId` to "ROOT" for top-level nodes

3. **Update Node**:
   - Updates GSI1SK on every update for proper sorting
   - Validates inputs/outputs if provided
   - Last-write-wins conflict resolution

4. **Delete Node**:
   - Uses BFS to collect all descendant node IDs
   - Extracts S3 keys from file references
   - Deletes S3 objects and DynamoDB nodes in batches
   - Returns counts of deleted nodes and files

**Dependencies**:
- Uses `lib.dynamodb` for all database operations
- Uses `lib.s3` for file cleanup on deletion
- Uses `lib.validation` extensively for input validation
- Uses `lib.auth` and membership checks

---

### `handlers/files.py` - File Upload/Download

**Purpose**: Handle file upload workflow (presigned URL generation and completion).

**Endpoints**:
- `POST /files/presign` - `presign_file()` - Generate presigned URL for upload
- `POST /files/complete` - `complete_file()` - Complete upload by adding file reference to node

**File Upload Flow**:
1. Client requests presigned URL via `/files/presign`
2. Server generates S3 key, file ID, and presigned PUT URL
3. Client uploads directly to S3 using presigned URL
4. Client calls `/files/complete` to add file reference to node's inputs/outputs
5. Server updates node with file metadata

**Why two-step process**:
- Allows direct S3 upload (faster, scalable)
- Verifies upload completion before updating database
- Keeps database consistent with actual S3 state

**Dependencies**:
- Uses `lib.s3` for presigned URL generation
- Uses `lib.dynamodb` to update node file references
- Uses `lib.validation` for file slot and metadata validation
- Uses `lib.auth` and membership checks

---

## Common Patterns

### Error Handling

All handlers follow this pattern:
```python
try:
    # ... handler logic ...
    return success_response(data)
except Exception as e:
    logger.error(f"Error message: {str(e)}", exc_info=True)
    return internal_error_response("User-friendly message")
```

Sentry (initialized in `lib/logging.py`) automatically captures exceptions.

### Authentication Pattern

```python
user_sub, auth_error = require_auth(event)
if auth_error:
    return auth_error
```

### Validation Pattern

```python
body, parse_error = parse_body(event)
if parse_error:
    return parse_error

valid, error_msg = validate_canvas_id(canvas_id)
if not valid:
    return error_response(code="INVALID_REQUEST", message=error_msg)
```

### Membership Check Pattern

```python
is_member, membership_error = require_membership(canvas_id, user_sub)
if not is_member:
    return membership_error
```

### Response Pattern

Always use standardized response functions:
- `success_response(data, status_code=200)` for success
- `error_response(code, message, details=None, status_code=400)` for client errors
- `internal_error_response(message)` for server errors

---

## Data Flow Examples

### Creating a Canvas

```
1. API Gateway receives POST /canvases
2. Lambda handler (create_canvas) executes
3. require_auth() extracts user_sub from JWT
4. parse_body() validates JSON body
5. generate_join_code() creates random code
6. get_canvas_table() gets DynamoDB table
7. Three put_item() calls create records
8. success_response() returns canvas data
```

### Querying Nodes

```
1. API Gateway receives GET /nodes?canvasId=...&parentNodeId=ROOT
2. Lambda handler (get_nodes) executes
3. require_auth() verifies user
4. parse_query_params() extracts query string
5. require_membership() checks canvas access
6. query_nodes_by_parent() uses GSI1 to find children
7. success_response() returns node array
```

### File Upload Workflow

```
1. Client: POST /files/presign {canvasId, nodeId, slot, filename}
2. Server: Generates presigned PUT URL → returns {fileId, s3Key, uploadUrl}
3. Client: PUT file directly to S3 using uploadUrl
4. Client: POST /files/complete {canvasId, nodeId, slot, fileId, s3Key, filename}
5. Server: Updates node's inputs/outputs array with file reference
6. Server: Returns updated node
```

---

## Key Design Decisions

1. **Shared Library Modules**: All handlers import from `lib/` to share code, reduce duplication, and ensure consistency.

2. **Sentry in logging.py**: Sentry initializes at module import time, guaranteeing it's active for all Lambda functions.

3. **Standardized Responses**: All endpoints use `lib.response` functions for consistent API format and CORS headers.

4. **DynamoDB Access Patterns**: 
   - CanvasTable uses PK/SK for efficient lookups
   - NodesTable uses GSI1 for parent-child queries
   - Denormalized user listing for fast canvas enumeration

5. **Two-Step File Upload**: Separates S3 upload from database update, enabling direct-to-S3 uploads while maintaining consistency.

6. **Cascade Delete**: Node deletion uses BFS to collect descendants, then batch deletes both DynamoDB records and S3 objects.

7. **Membership Model**: Separate membership records enable multi-user canvases while maintaining access control.

---

## Adding New Functionality

When adding new endpoints:

1. **Create handler function** in appropriate `handlers/*.py` file
2. **Follow the pattern**: Auth → Validate → Authorize → Business Logic → Database → Response
3. **Use lib modules**: Import from `lib.*` for common operations
4. **Add to template.yaml**: Register new Lambda function and API route
5. **Test error cases**: Ensure validation and error responses work correctly

When adding new utilities:

1. **Consider placement**: Does it belong in `lib/` as shared code?
2. **Follow existing patterns**: Use `lib.response` for errors, `lib.logging` for logs
3. **Document functions**: Add docstrings explaining purpose and parameters
4. **Handle errors gracefully**: Return `None` or empty results rather than raising exceptions

---

## Environment Variables

Used throughout the codebase:
- `CANVAS_TABLE` - DynamoDB table name for canvases (set in template.yaml)
- `NODES_TABLE` - DynamoDB table name for nodes (set in template.yaml)
- `FILES_BUCKET` - S3 bucket name for file storage (set in template.yaml)
- `USER_POOL_ID` - Cognito User Pool ID (set in template.yaml)
- `LOG_LEVEL` - Logging level (default: "INFO")
- `AWS_REGION` - AWS region (default: "us-east-1")

---

This architecture ensures separation of concerns, code reuse, consistent error handling, and maintainability across the entire backend codebase.
