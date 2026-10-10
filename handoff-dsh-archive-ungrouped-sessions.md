---
name: handoff-dsh-archive-ungrouped-sessions
description: "Archive all DSH ungrouped sessions via workspace RPC"
metadata:
  type: project
---

## Objective

Archive every DSH session that currently appears under the "Ungrouped" bucket in the sidebar, using the JSON-RPC API (not UI clicking). This replaces the older approach of hand-archiving known session IDs.

## DSH Architecture (RPC contract)

DSH runs on `http://127.0.0.1:3080`. All RPC calls are POST to `/api/<method>` with a JSON body:

```json
{
  "type": "client-request",
  "rpcId": "<any-uuid>",
  "method": "<rpc-method-name>",
  "payload": { ... }
}
```

Key endpoints:

**1. `workspace.list`** → `POST /api/workspace.list`, payload `{}`
Response: `{ ok: true, value: { items: WorkspaceView[], archivedSessionIds: string[] } }`
Each `WorkspaceView` has `workspaceId`, `path`, `title`, `sessionIds: string[]`, `createdAt`, `updatedAt`.
`archivedSessionIds` is the registry-global archive set (the reconnect baseline).

**2. `session.list`** → `POST /api/session.list`, payload `{}`
Response: `{ ok: true, value: { items: SessionSummary[] } }`
Each `SessionSummary` has: `sessionId`, `updatedAt`, `running`, `blank`, `parentSessionId?`, `cwd?`, `agentPreset?`, `projections?`.
This lists ALL sessions — workspace-accounted, ungrouped, and archived.

**3. `workspace.archiveSession`** → `POST /api/workspace.archiveSession`, payload `{ sessionId: string }`
Response: `{ ok: true, value: { archivedSessionIds: string[] } }`
Idempotent: already-archived IDs resolve without writing. Unknown IDs fail with `session-not-found`.

**4. `workspace.delete`** → `POST /api/workspace.delete`, payload `{ workspaceId: string }`
Deletes only the workspace registration. Sessions become ungrouped but remain in `session.list`.

## Algorithm: discover → archive → verify

### Step 1: Discover ungrouped sessions

```
GET workspace.list → { items, archivedSessionIds }
GET session.list   → { items: allSessions }

// Build set of all workspace-accounted session IDs
workspaceSessionIds = Set()
for each workspace in items:
  for each sid in workspace.sessionIds:
    workspaceSessionIds.add(sid)

// Ungrouped = all sessions NOT in any workspace AND NOT archived
ungroupedSessions = []
for each session in allSessions:
  if not workspaceSessionIds.has(session.sessionId)
     and not archivedSessionIds.has(session.sessionId):
    ungroupedSessions.push(session)
```

Note: blank sessions may appear in session.list. A blank session is one where no turn has run yet (`blank: true`). These are typically newly-created "empty" sessions. Decide whether to archive blank ungrouped sessions (recommend: skip blanks, archive only non-blank sessions).

### Step 2: Archive each ungrouped session

```
for each session in ungroupedSessions:
  response = POST /api/workspace.archiveSession {
    "type": "client-request",
    "rpcId": uuid(),
    "method": "workspace.archiveSession",
    "payload": { "sessionId": session.sessionId }
  }
  if response.ok:
    record: archived session.sessionId
  else:
    record: failed session.sessionId with error code
    continue (do not stop)
```

### Step 3: Verify

```
GET workspace.list → { items, archivedSessionIds }
// Confirm each previously ungrouped session is now in archivedSessionIds
// Confirm no ungrouped sessions remain in session.list that are non-blank
```

## Safety properties

- **Idempotent**: `archiveSession` on an already-archived ID resolves without writing.
- **Reversible**: Archived sessions keep their session log and `sessionIds` slot; unarchiving restores position.
- **Safe rejection**: Unknown session IDs fail with `session-not-found` — does not corrupt anything.
- **Never touch `session.delete`**: Archiving is the correct operation; deletion is destructive.

## Error handling

- `session-not-found`: session no longer exists or was already removed. Log and continue.
- `internal`: server error. Retry once with a new rpcId; if it fails again, log and continue.
- Network errors: retry once.
- Always collect all errors and report at the end — do not stop on the first failure.

## Reporting

After the operation, report:
1. Total sessions discovered
2. Ungrouped non-blank sessions found
3. Sessions archived (list of session IDs)
4. Sessions skipped (blank, with count)
5. Failures (session IDs and error codes)
6. Verification result (zero ungrouped non-blank sessions remaining? yes/no)

## Constraints

- **Do NOT** archive the current active session (the one making the request).
- **Do NOT** archive sessions that have `running: true` (live work in progress).
- **Do NOT** touch sessions that belong to a workspace (even if the workspace path is stale).
- **Do NOT** run `session.delete` under any circumstances.
