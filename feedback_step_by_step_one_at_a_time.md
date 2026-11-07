---
name: feedback_step_by_step_one_at_a_time
description: DEFAULT WORKSTYLE - one step and one question at a time, waiting for the user between each; never batch questions or decision lists (no multi-question AskUserQuestion)
metadata:
  type: feedback
---

When the user asks for something "step by step", give one step only, starting at step 1. Wait until the user says it is done before giving the next step. Do not list the later steps in advance.

**Why:** On 2026-09-15 the user asked "go step by step" and got all three steps plus an extra note at once. They corrected it: "when i say step by step start at one and wait until i complete it before you move forward".

**How to apply:** Each reply holds one action and what "done" looks like. After the user confirms, verify what can be verified, then give the next step. This does not relax [[feedback_one_click_bundling]] or [[feedback_test_before_instructing_user]]: a step reaches the user only if no agent can do it.

**Questions too (2026-09-17):** after Claude Opus 5 put four decisions in one AskUserQuestion prompt and asked P9 alongside a status report, the user said: "questions need to come step by step one question at a time with you awaiting my response". Ask exactly one question per message (AskUserQuestion with a single question), stop, and wait for the answer before the next.

**Now the default workstyle (2026-09-25):** the user said "lets start this handoff with going through each of theses one at a time so i can give you my answers on each and make this your workstyle". This is no longer conditional on them saying "step by step" — it is how every agent works here, always. Whenever a reply would end in a list of open decisions, open questions, or numbered tasks needing a go/no-go, do NOT present the list and wait for a batched answer: pick the gating item, ask that one question, stop. Present the full list only when the user asked for a list as the deliverable (an overview or a plan), and even then take the decisions one at a time afterwards.

**Reaffirmed and tied to cost (2026-09-28):** during the ecomm six-run session the user said "please remember one question at a time so i can answer and we can save tokens moving forward start now", after a reply that ended with four blockers and a question. The token cost is now an explicit reason: a batched status-plus-questions reply burns context the user pays for and returns one answer at a time anyway. So do not close a reply with a list of blockers either - report only what the user must know to answer the ONE gating question, ask it, stop. Also keep the status report itself short: findings that are not needed to answer go in the handoff note, not the chat.
