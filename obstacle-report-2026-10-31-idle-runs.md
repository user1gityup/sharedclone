---
name: obstacle-report-2026-10-31-idle-runs
description: Why every DSH run on 2026-10-31 died, what finished work is ready to review, and what unblocks the rest
metadata:
  type: project
---
# Obstacle report: nothing running, 2026-10-31

Claude Opus 5.5, vmixer2o2, 21:40Z / 2:40 PM PT. Source: `~/.dsh/council-runs/active/RUN-20261031-*.json` and their logs, pm at 127.0.0.1:4480.

## Bottom line
29 runs started today. None is alive. Two obstacles killed them all:

| # | Obstacle | Runs hit | Fix | Who |
|---|---|---|---|---|
| 1 | **CheaperInference wallet empty**: `402 Insufficient wallet balance` (provider inferred from run paths) | 017, 020-022, 024-029 (10) | Top up the wallet, or re-run those tasks on free seats (FCC / local llama) | You: top-up is money; seat pick is yours by rule |
| 2 | **OpenClaw ChatGPT web transport broken**: prompt staging failed, page closed, tab not found, model switch refused | 001-013 (13), economy mode, 15:20-15:44Z | Repair the OpenClaw ChatGPT seat (see webchat council free lane note), or leave it out of rosters | Agent fix; no user step |
| 3 | DSH marks runs `failed` even when they wrote `DSH-AUTO-RESULT.json` = COMPLETED, validation passed | 018, 023 | Status mapping bug in the run supervisor | Agent fix |
| 4 | 3 pm tasks still in RUNNING from 09-28 (T-2170d910, T-0fb72edd, T-b6457931) | none | Close or reset them in pm | Agent, on your OK |
| 5 | Flow Pac called recently touched flows "running" | page only | Fixed 21:32Z: running = live run only | Done |

014-016 were stopped by hand (retries of T-1d988698). 012 exited because the `pipeline` tool was missing in that session.

## Ready to review now (finished, validation passed)
| Run | pm task | Work | Folder |
|---|---|---|---|
| RUN-20261031-018 | T-6809f7f2 | BLITZ-09 P2: PM project picker, Q&A and approval UI | `dsh-runs/idle-2026-10-31/T-6809f7f2/out` (19 files) |
| RUN-20261031-023 | T-656db537 | Wyze FCM push ring receiver (Path C) | `dsh-runs/idle-2026-10-31/T-656db537/out` (17 files) |
| RUN-20261031-019 | T-128907bd | Source code intake + baseline audit (deliverables done; BLOCKED only on a quota-held seat's approval) | `dsh-runs/idle-2026-10-31/T-128907bd/out` (9 files) |

## Partial work on disk (stopped mid-run by the 402, resumable)
| Run | pm task | Work | Files | State at stop |
|---|---|---|---|---|
| 017 | T-1d988698 | DSH PM verification scope (Q12/Q40/Q57-Q59) | 120 | building |
| 020 | T-7f3ea863 | Bulk-select projects/tasks to Weight Router | 36 | fixing a test |
| 021 | T-c4a47167 | WebChat unified model menu charter | 135 | src staged, tests pending |
| 022 | T-4daf36e3 | Front-door stream forensic audit | 108 | deliverables present, tests 24/24 |
| 024 | T-b016d0e5 | Lead Intel WP0 baseline retest + fixes | 2227 | reading results |
| 025 | T-adcf1bad | Event Manager phase 0 reuse map | 94 | passes validation, result file not written |
| 026 | T-631e73b7 | Regulated rules engine (age gate, jurisdiction) | 302 | running tests |
| 027 | T-d1ce086c | Line-item partial refund | 67 | creating deliverables |
| 028 | T-43da7fd2 | Public Opportunity Scraper | 27 | plan done, advancing |
| 029 | T-8b68240c | Contact record model | 5 | just started |

All folders under `~/Documents/claudecode/dsh-runs/idle-2026-10-31/<task>/out`. The runs were started with `resume: true`, so each can continue from its folder.

## To get things running again
1. Pick seats for the 10 resumable runs (rule: you pick, never defaulted). Free choices that are not out of balance: FCC, local llama.
2. Or top up CheaperInference, then resume the same 10 as they were.
3. Leave OpenClaw ChatGPT out of rosters until obstacle 2 is fixed.

ETA once seats are picked: about 75 min per run, run in parallel (estimated from today's 18:11-18:59Z wave, which used about 45-50 min before the 402).
