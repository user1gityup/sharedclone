---
name: handoff-2026-09-25-0207-dsh-pwa-install-button
description: Read-only Q&A explaining the browser "Install DeepSeek Harness" omnibox button on DSH; PWA manifest confirmed live, nothing changed
metadata:
  type: project
---

# Handoff 2026-09-25 02:07 PDT: DSH "Install DeepSeek Harness" button

Stable handoff id: `handoff-2026-09-25-0207-dsh-pwa-install-button`
Updated: 2026-09-25 02:07 PDT
Host: `vmixlaptop2x6` (user profile `ndi2`)
Session id: `73552eea-f29e-48ea-b42a-b13bc0841fd1`
Model: Claude Opus 5
Repo: `~/Documents/claudecode/deepseek-harness`, branch `feat/heterogeneous-teammates`, HEAD `0d49b54f8b`, working tree CLEAN
Owner: Claude Opus 5 (this session). No collaborating agents.
Remote Control: not enabled this session.

## The user's exact ask

1. "dsh is now showing an install deepseek harness button at end of the url window what is that?"
2. "so what would installing it give me besides no url window ?"
3. "show me how it will look"

Read-only explanation task. No code change was requested or made.

## What is done, with evidence

**Identified: it is the browser's PWA install affordance, not a DSH feature.**

- `apps/web/index.html:6` -> `<link rel="manifest" href="/manifest.webmanifest" />`
- `apps/web/public/manifest.webmanifest` ships `"name": "DeepSeek Harness"` (the exact button text), `short_name` `DSH`, `id`/`start_url`/`scope` = `/`, `display: "fullscreen"`, single icon `/favicon.svg`.
- Shipped upstream in commit `8f2168303b` (2026-08-06, "feat(web): add install metadata") -- so every build since then has had it. The button appearing "now" is browser-side (Chrome/Edge engagement heuristics), NOT a recent DSH change.
- Rationale doc: `.agents/notes/implemented/feature/2026-08-06-web-install-manifest.md`. Explicitly: no service worker, no offline contract, no `lang`/`theme_color`/`background_color`, follows code-server's fullscreen choice, rejects `window-controls-overlay`.
- `packages/host/frontend-static/src/index.ts:46` maps `.webmanifest` -> `application/manifest+json`.

**Verified LIVE against the running DSH host (port 3080):**

```
curl -s -i http://127.0.0.1:3080/manifest.webmanifest
HTTP/1.1 200 OK
content-type: application/manifest+json
{ "id": "/", "name": "DeepSeek Harness", "short_name": "DSH",
  "start_url": "/", "scope": "/", "display": "fullscreen", ... }
```

**Browser-pane measurements (real, from `javascript_tool` on `http://localhost:3080`):**

- `display-mode` currently `browser: true`, `standalone: false`, `fullscreen: false` -> confirms it is NOT installed yet.
- Screen `1920x1080`, `availHeight 1080`, `devicePixelRatio 1`.
- `document.title` = "DSH Local Build"; manifest link resolves to `http://localhost:3080/manifest.webmanifest`.
- DSH sidebar measured `280px` wide at `innerWidth 1024` (ratio `0.273`), full `768px` height.

**Grep-confirmed absences** (so the "what you don't get" list is factual, not assumed): no `new Notification(`, no `Notification.requestPermission`, no `setAppBadge`, no `launch_handler`, no `file_handlers`, no `protocol_handlers`, no `share_target`, no `window-controls-overlay` anywhere in the repo outside the note's prose. No `document.title` mutation in `packages/client`, so the window title stays static.

**Answers delivered to the user:** (1) what the button is; (2) gains = own taskbar/Alt-Tab entry, survives browser close, browser key shortcuts stop hijacking, `scope` containment pops off-scope links to the real browser, fullscreen display request; non-gains = no offline, does not start the DSH host, no storage isolation (same browser profile), no notifications/badges, SVG-only icon renders inconsistently on Windows, Chrome on Windows often downgrades `fullscreen` to `standalone`.

## What is half-done

Ask 3 ("show me how it will look") was in progress at the handoff trigger. A real screenshot of the DSH UI at `http://localhost:3080` was already captured in the browser pane (sidebar + New Session, Workspaces list, quota rows Antigravity 86.6% / Codex 100% / Claude 0% / Council Budget $0.077 / CheaperInference $15.00 / OpenRouter Monitor, Settings; main pane with an expired "Proposing round", "Pipeline idle", and the "Into the Unknown" hero + composer). The remaining step is rendering a to-scale before/after window-chrome comparison via `mcp__visualize__show_widget`.

`mcp__visualize__read_me` output was too large for context and was persisted to
`~/.claude/projects/C--Users-ndi2-Documents-claudecode/73552eea-f29e-48ea-b42a-b13bc0841fd1/tool-results/mcp-visualize-read_me-1790327223651.txt`.
Lines 41-126 (rules + CSS variables + UI components) have been read and are sufficient; do not re-read the whole file.

## Files, processes, ports

- No file in any repo was created, edited, or deleted. Working tree is clean at `0d49b54f8b`.
- No commits, no queue entries, NO PUSH.
- DSH host running and serving on `127.0.0.1:3080` (not started by this session; left running).
- Browser pane opened by this session at `http://localhost:3080`, serverId `preview-local_1c2165aa-1e14-4e79-bcec-011da885aa72`, tabId `seed`.

## Permissions and open questions

No permission was denied. No credential was touched. No open question blocking the user -- the explanation is complete; only the visual remains.

## Exact next action

Render the comparison visual with `mcp__visualize__show_widget` (title e.g. `dsh_pwa_install_window_comparison`), using the measured numbers above: 1920x1080 screen, 27.3% sidebar ratio, typical Chrome-on-Windows chrome band vs a standalone app window's ~32px title bar. Label approximate chrome heights AS approximate -- their actual Chrome toolbar was not measured.

## Verification / do-not-repeat

- Do NOT re-grep the whole repo with Bash `grep -rn` across everything: that timed out at 120s (background id `biowu208i`). Use the Grep tool (ripgrep, respects gitignore) instead.
- Do NOT claim the manifest is new. It is from 2026-08-06; only the browser's surfacing of it is new.
- Do NOT claim installing it enables offline use, starts the harness, or isolates storage. All three are false and were verified false.
- The live 3080 probe and the `display-mode` reading are already done; re-running them is unnecessary.

-- Claude Opus 5
