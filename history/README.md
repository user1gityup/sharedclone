# History exports

One folder per machine: `history/<hostname>/`, with the sanitized DSH settings in `system/<hostname>/`. Each folder's `README.md` says when it was exported, what it covers and what stays local-only.

The exports are redacted evidence snapshots of records that otherwise exist only on that machine (Claude Code and Codex sessions, DSH council runs, journals and agent sessions, PowerShell gatekeeper receipts). The live notes stay authoritative.

Refresh a machine by running `.sync/EXPORT-HISTORY.cmd` on it (or `EXPORT-HISTORY.cmd` on the clone drive): it syncs the brain, exports, scans and commits locally. It never pushes.
