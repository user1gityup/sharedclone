# History exports — vmixer2o2

Redacted, compact exports of agent records that otherwise exist only on vmixer2o2's disk. **Evidence snapshots**, not live state and not a second brain; the live notes (`MEMORY.md`, `shared-agent-log.md`, handoffs, `push-requests.md`) stay authoritative.

- **Exported:** 2026-09-15T10:24:15.919Z by `.sync/export-history.mjs`. Each run replaces this folder and `system/vmixer2o2/`. Refresh with `.sync/EXPORT-HISTORY.cmd`.
- **Redaction:** credential shapes (API keys, JWTs, private keys, 64-hex keys), values under secret-named keys, e-mail addresses, account names and home paths (`~`). Long text truncated where marked. Exact user wording is kept only for the first three and the last ask of each session, each up to 400 characters. 35 values redacted this run.
- **Scan:** the exporter re-reads every file it wrote and fails on a credential shape, the brain key, an e-mail or a home path.

| Export | Source (local-only) | Count | Span |
|---|---|---|---|
| [claude-code/](claude-code/) sessions by month | `~/.claude/projects/<key>/<session>.jsonl` | 153 | 2026-08-15 → 2026-09-15 |
| [claude-code/dsh-seat-calls.md](claude-code/dsh-seat-calls.md) | `~/.claude/projects/*dsh-seat-cwd*` | 74 | |
| [codex/sessions.md](codex/sessions.md) | `~/.codex/sessions/**/rollout-*.jsonl` | 12 | 2026-09-06 → 2026-09-13 |
| [codex/exec-calls.md](codex/exec-calls.md) | same, originator `codex_exec` | 55 | |
| [codex/workspaces.md](codex/workspaces.md), [codex/outputs/](codex/outputs/) | `~/Documents/Codex/<date>/<slug>/` | 9 dates, 4 docs | |
| [dsh/README.md](dsh/README.md) council runs + journals | `~/.dsh/council-runs/` | 5 runs, 1 journals | 2026-09-07 → 2026-09-07 |
| [dsh/sessions.md](dsh/sessions.md) | `~/.dsh/sessions/**/session.jsonl.zstd` | 27 sessions, 2 subagent | 2026-08-25 → 2026-09-15 |
| [gatekeeper/receipts.md](gatekeeper/receipts.md) | PowerShell gatekeeper `state/*.json` | 17 | 2026-09-09 → 2026-09-15 |
| [../../system/vmixer2o2/dsh-settings.sanitized.yaml](../../system/vmixer2o2/dsh-settings.sanitized.yaml) | `~/.dsh/settings.yaml` | parsed | |

## Still local-only

- Full transcripts: tool inputs and outputs, reasoning, every message. Only summaries are exported.
- `~/.dsh/memory`, DSH seat homes, Antigravity seat state and every auth folder.
- `~/.dsh/.credentials.yaml` (sealed copy: `../../dsh-credentials.enc`), `~/.claude/brain-secrets.key` and the local `keys` branch. **Never exported.**
- Codex workspace code, `work/` staging clones, `test-runs/`, dependencies.
