# AI4JOB EdgeOne Pages MVP Design

## Goal

Make the project deployable on EdgeOne Pages as a minimum viable version.

This version should preserve the core text-based workflow that can run in an edge-compatible environment, while clearly degrading heavy features that currently depend on local filesystem access, long-lived Node servers, or system binaries.

## Scope

### Keep working in MVP

- Static web app entry
- Text-based job parsing
- Text-based resume analysis and optimization workflow
- OpenAI-backed API calls that only require standard HTTP requests
- Existing route names where practical, to reduce frontend churn

### Degrade for now

- File upload and file library persistence
- Local `storage/` reads and writes
- Optimization session persistence on the server
- PPT preview and PPT-to-PDF conversion
- Any feature that depends on `fs`, `child_process`, `curl`, `unzip`, `libreoffice`, temp directories, or long-lived process state

### Messaging requirements

- Unsupported features should not crash
- The API should return stable structured responses for unsupported endpoints
- The UI should show clear Chinese messages:
  - `EdgeOne Pages 最小版暂未实现`
  - `等待后续开发`

## Constraints

- EdgeOne Pages does not support the current Node server model with `createServer(...).listen(...)`
- Edge runtime should avoid Node-only modules such as `node:fs`, `node:child_process`, and filesystem persistence
- The first milestone optimizes for deployability, not full feature parity

## Recommended Approach

Use a split architecture:

1. Static frontend remains based on the current `index.html`
2. Server logic is moved behind EdgeOne Pages-compatible request handlers
3. Runtime-specific capabilities are isolated so unsupported features can be stubbed cleanly

This keeps the current product usable while creating a clean seam for future storage or file-service integrations.

## Architecture

### Frontend

- Continue serving the existing page as a static asset
- Preserve visible entry points where possible
- Replace unsupported actions with explicit status messaging instead of broken flows

### API

- Replace the current Node HTTP server entry with a Pages-compatible function entry
- Keep supported endpoints functional
- Keep unsupported endpoints present, but return structured "not implemented yet" payloads

### Service Layer

- Preserve pure text-processing and remote-fetch logic that can run in edge-compatible JavaScript
- Remove direct dependencies on local disk and process execution from the MVP path
- Allow future adapters for object storage or DB-backed persistence

## Data Strategy

The MVP is primarily stateless on the server.

- Request-local processing remains supported
- Cross-request persistence is deferred
- If the current UI depends on saved state, prefer frontend-local state where feasible
- Otherwise, return a clear unsupported message

## Endpoint Strategy

### Supported now

- Health/status endpoint
- Text-only parsing and optimization endpoints that can execute without local files

### Unsupported for MVP

- Job material file upload/download
- Server-side material management backed by local disk
- Persistent optimization session continuation if it requires server storage
- PPT preview conversion

Unsupported endpoints should return JSON in a consistent shape, for example:

```json
{
  "ok": false,
  "code": "EDGE_MVP_NOT_IMPLEMENTED",
  "error": "EdgeOne Pages 最小版暂未实现该能力"
}
```

## Implementation Plan

1. Introduce a Pages-compatible API entrypoint
2. Refactor supported text workflow code to be runtime-safe
3. Stub unsupported endpoints with consistent responses
4. Update the frontend to handle degraded responses and show user-facing notices
5. Add EdgeOne Pages deployment documentation
6. Keep current Docker/Node deployment docs only as legacy or alternate deployment notes

## Risks

- Existing optimization flow may still be tightly coupled to session persistence and need light refactoring
- The current frontend may assume file/material endpoints always exist and succeed
- Some fetch logic may still rely on Node behaviors and need cleanup during implementation

## Success Criteria

- The project has a clear EdgeOne Pages deployment structure
- The page can load without the old Node server bootstrap
- Core text workflow endpoints run in the new deployment model
- Unsupported heavy features fail gracefully with explicit messaging
- Documentation clearly separates supported MVP features from deferred work
