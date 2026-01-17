# Glass Box Backend

This directory contains the backend logic for Glass Box.

## Structure (planned)

```
backend/
├── handlers/       # IPC handlers for main process
├── services/       # Business logic and data services
├── database/       # Local data storage (SQLite/JSON)
└── utils/          # Shared utilities
```

## Responsibilities

- Data persistence (nodes, execution logs, evidence)
- File system operations
- IPC communication with renderer process
- Real-time collaboration sync (future)
