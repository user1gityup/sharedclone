---
name: dsh-council-plugin
description: "The multi-agent council plugin in the user's DeepSeek Harness fork — seats, the two-factor approval gate, research, and where its code lives"
metadata: 
  node_type: memory
  type: project
  originSessionId: be428cdb-8d94-4adb-8bc9-22d446db25cf
  modified: 2026-09-02T08:56:45.485Z
---

The user runs a fork of DeepSeek Harness at `~\Documents\claudecode\deepseek-harness` with a multi-agent **council** plugin built into it (started 2026-08-25). Work lives on branch `feat/heterogeneous-teammates`, **pushed to the private fork** `github.com/user1gityup/deepseek-harness` as of 2026-09-05 (`705b4345c4`); the private repo is now `github.com/user1gityup/lseekv1` (origin repointed 2026-09-17).

**Seats** — five, colour-coded: Claude (cyan, `claude -p` CLI, subscription), **Free Claude** (same binary routed through a local Free Claude Code proxy — see [[free-claude-code-setup]]), OpenAI (green, `codex exec`), Kimi (magenta, OpenRouter `moonshotai/kimi-k2`), DeepSeek v4 (yellow, `deepseek/deepseek-v4-pro`).

**The OpenAI seat went live 2026-09-05.** Codex CLI installed with `npm i -g @openai/codex` (0.153.4), signed in on the ChatGPT subscription. Its argv is `exec --skip-git-repo-check {prompt}`; the flag is not optional, because `codex exec` refuses to run outside a git repo and the council's cwd usually is not one. Four defects stood between "installed" and "working" — all in [[dsh-harness-gotchas]]. The stdin one is the trap worth carrying forward: a deadlocked seat is indistinguishable from a slow one until you look at stdout and find it empty.

**Enabled seats as of 2026-09-05: claude, free-claude, openai.** Kimi and DeepSeek off, so a council run costs nothing on OpenRouter. Measured latency on a one-word prompt: codex ~8s, claude ~8.8s median, free-claude ~6-19s depending which provider FCC routes to.

**`~/.dsh/verify-council.cmd` proves the whole CLI path in one run** — 16 checks, exit 0 or 1: settings.yaml shape, both harness fixes present in the *compiled* `lib/index.js`, codex resolving from the bare name, FCC listening, and a live round on each CLI seat with a timing assertion that catches the stdin deadlock if it ever returns. Run it after any harness change before trusting a council result. Costs one round per CLI seat, nothing metered.

**Flow**: research round (seats say what they want looked up) → planning round (every seat proposes a plan, council votes) → **approval gate** → drafts → reviews → confidence-weighted vote with citation audit.

**The approval gate is two-factor and this matters.** A `plan` argument is NOT evidence of approval — the model is the caller and wrote its own plan to bypass the gate, spending $0.44 unasked. Approval now needs both a button press (writes `approvedPlanId` to settings, a channel no model-facing tool can reach) and a user message after it. Every caller flag that could weaken the gate is ignored while unapproved; the model reached for `planOnly`, then `skipPlan`, and would reach for the next one. Approvals are single-use and expire after 15 minutes.

**Packages**: `packages/council/tool-council` (host: `council`, `council_capacity`; modules for approval, evidence, verify, decompose, roster, execution-cost), `packages/memory/agent-memory`, `packages/web/web-search-cli`, `packages/client/ui-council-budget` (budget panel + the council's own tool view). Registered in `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`. ~184 tests.

**Why:** the user wants multiple models checking each other inside a $60/month budget, and will not accept an agent acting or spending without asking. See [[user-budget-parameters]].

**Shared memory for seats (2026-09-11):** every seat and swarm worker receives the shared brain's index ahead of the agent-memory digest - `resolveMemory` in `src/index.ts` writes `~/.dsh/memory/council-context.md` for CLI seats and inlines the same text for hosted seats. `brainIndex: false` turns it off; `tests/memory.spec.ts` covers it. See [[shared-memory-protocol]].

**How to apply:** settings live in the `council` namespace of `$DSH_HOME/settings.yaml`, read per invocation. Key switches: `councilMode`, `planMode` (`council` default), `seatResearch` (on, free), `webMaxResults` (0 — metered per-seat search, ~25x cost), `autoApprove`. See [[dsh-harness-gotchas]] for the traps that cost hours, and [[dsh-swarm-disabled]] for the parked swarm work.

**Run and fact sharing (2026-09-11):** saveRun calls shareRun to append to [[dsh-runs]], and agent-memory digest refresh calls shareFacts to append to [[dsh-memory]] and include facts from other machines. The launch/session collector also imports older records without a harness rebuild. GPT-6 verified the compiled libraries contain these calls and reran both package suites after c5a54779: 29 files, 429 tests passed, exit 0. See [[shared-memory-protocol]].
