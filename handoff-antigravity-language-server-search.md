---
name: handoff-antigravity-language-server-search
description: One-shot web search on Antigravity language_server.exe agentapi/stdin transport, completed same turn — no continuation needed
metadata:
  type: project
---

Handoff id: antigravity-language-server-search-2026-09-12
Updated: 2026-09-12, host: ndi2 machine, session: DSH search-cwd (~\.dsh\search-cwd, not a git repo)
Model: Claude Sonnet 5 (claude-sonnet-5)
Owner: Claude Sonnet 5 (this session). No collaborating agents.

**User's exact ask:** search the web for "antigravity language_server.exe agentapi interface documentation file stdin transport" and reply with a JSON object {"summary", "sources"}.

**Done, with evidence:** Ran WebSearch, then WebFetch on github.com/steipete/CodexBar/blob/main/docs/antigravity.md. Finding: no public doc describes a `language_server.exe` stdin/JSON-RPC transport for Antigravity's agentapi. What exists instead (per CodexBar's reverse-engineering notes and the Antigravity-Tools-LS project): the language server runs as a local process exposing Connect-protocol RPC over loopback HTTPS (self-signed cert, `127.0.0.1:<port>`, `X-Codeium-Csrf-Token` / `Connect-Protocol-Version: 1` headers, `exa.language_server_pb.LanguageServerService` methods like `GetUnleashData`, `RetrieveUserQuotaSummary`, `GetUserStatus`). This is consistent with [[project_antigravity_agy_seat]] (no agy binary, must attach to the IDE language server) and [[project_antigravity_seat_pool]] (loopback, self-authenticating, HOME-keyed).

JSON answer returned directly to the requester in this same turn.

**Half-done / pending:** none — task fully answered in this turn, no files changed, no processes started.

**Open questions:** whether a stdin-based transport exists elsewhere in Antigravity (a different binary/mode) is still unconfirmed; nothing found in this pass says so either way.

**Next action:** none. This note exists only because a 95%-week-quota handoff hook fired mid-task; safe to delete or ignore once quota resets (2026-09-15 ~1am) if no further Antigravity transport work follows.

**Do not repeat:** CodexBar's antigravity.md explicitly does not mention `language_server.exe`, `agentapi`, stdin, or JSON-RPC — don't re-fetch that page expecting those terms.
