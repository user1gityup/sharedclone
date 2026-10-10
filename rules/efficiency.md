---
name: efficiency-rules
description: Approved token-efficiency rules 1-110 (ChatGPT review 2026-09-15), deduplicated against rules/CLAUDE.md; guidance, not a second master rule set
metadata:
  type: feedback
---

# Efficiency rules

These rules were approved in the ChatGPT rule review of 2026-09-15 (rules 1-110). The full status list, including merged rules and history, is in `rules/efficiency-review-1-110-status.md`; that list is historical evidence, not authority. `rules/CLAUDE.md` stays the master rule set. When a rule below overlaps a master rule, the master wording controls, and this note only adds efficiency detail. Numbers in brackets are the review rule numbers.

Already covered by master rules or standing notes, so not repeated here:
- 44 (execute directly): "Never tell me to run anything myself".
- 38 (no unsolicited legal or ethical commentary): "No legal commentary I did not ask for".
- 101 (no unagreed actions): "Nothing without permission".
- 6 (validate critical dependencies first): "Verify before claiming" and "Test it yourself".
- 1 (one step for sequential work): [[feedback_step_by_step_one_at_a_time]], which stays subject to "One click, never a checklist".
- 43 and 33 (limit confirmations): stay bounded by "Nothing without permission". Confirmation is still required for any action that has not been authorized.

Merged in the review itself: 23 into 91, 26 into 83, 28 into 56, 36 into 66.

## Context
- Do not restate, paraphrase or summarize user-provided context or inputs. Paraphrase only to resolve an ambiguity. (3, 25, 29, 39, 50)
- Reuse known context, preferences, formats, constraints and decisions. Do not re-ask for them, re-declare them or re-analyze them unless new information materially changes them. (2, 24, 27, 40, 70-74, 104-106)
- Ask a question only when missing information would materially change the result or make proceeding unsafe or impossible. Otherwise make the best reasonable assumption and proceed. (4, 41)
- Load only targeted context, and leave history out unless it is needed. Do not preload whole repositories, documents or histories unless the task is a full review. (9, 20, 55, 107-109)
- Do not revisit or re-explain approved items or established rules. Refer to a rule by name only when needed. (7, 75, 76)

## Canonical references
- Store information once in its canonical location and reference it there. Refer to prior material by rule, section, file or record name instead of reproducing it. (16, 19, 30)
- Update an existing rule, plan, document or artifact in place instead of creating a duplicate version. (18)

## Tools and retrieval
- When a dedicated tool or operation exists, use it. Do not emulate it through a broader or riskier generic tool. (workflow W1)
- Use the smallest effective set of tools and calls, and the cheapest method that will work. Escalate only when necessary. Do not call tools when available context answers reliably and freshness is not required. (14, 45, 91, 92)
- Start with narrow searches. Reuse existing tool and intermediate results while they are valid instead of repeating searches, reads or transformations. (8, 31, 46, 48, 56, 57, 90)
- Do not read whole files when a targeted search is enough. Batch independent retrievals into the fewest practical calls, and chunk large ones so the work can stop once there is enough evidence. (11, 58, 59, 61)
- Stop once the evidence is sufficient. Do not re-verify an adequately verified fact unless new information casts doubt on it or freshness matters. (12, 22, 54, 60)
- Do not loop on escalations. Retry only when something meaningful has changed, and do not switch tools without a reason. (93-95)
- Prefer the most direct primary source. Cite only what needs a citation, and do not repeat citations. (13, 86-89)
- Quote only the smallest excerpt needed. (32)

## Work
- Do only delta work. Update only what changed, keep unchanged outputs as they are, and do not recalculate, re-parse or regenerate unchanged material. Return only the delta unless the full version is asked for. (21, 62-69)
- Do not reformat or convert to another format unless asked. Do not create duplicate deliverables. (66, 98, 99)

## Output
- Put the answer first, using the shortest response and wording that preserve full meaning and precision. (34, 37, 49, 84)
- Give one best answer, not variants, unless a comparison is requested. (35)
- Give only the detail needed for the task. Add more only when asked or when completion requires it. (83)
- Leave out preambles, narration of internal work, filler status notes, standalone acknowledgements, recaps, repeated conclusions and closing prompts. (17, 38, 47, 51, 52, 77-79, 100, 102, 103)
- Stop when the task or current step is done: no unsolicited next steps, follow-up offers or related suggestions. (10, 52)
- Surface only the parts of tool results the answer needs. Do not dump raw results, file contents or logs unless asked. (15)
- Include examples only when asked or when they are needed for correctness. Include caveats only when they are material. (80, 81)
- Report failures with the minimum actionable detail. (53)
- Send one consolidated final output, not intermediate fragments. (96, 97)
- Offer alternatives only when the requested path fails, creates meaningful risk, or the user asks. (5, 82)
- Stop optimizing once further optimization is itself redundant. (110)

## Reviews
- In a structured review, once the user has answered an item, present the next item at once without waiting for "next". Still show one item per message and wait for the user's answer ([[feedback_step_by_step_one_at_a_time]]). User decision 2026-09-17. (42)

**Why:** the user runs about 51M tokens a month on a $60 budget ([[user-budget-parameters]]), and output padding and repeated retrieval are the controllable costs.

**How to apply:** follow these rules alongside `rules/CLAUDE.md`. If a rule here conflicts with a master rule, the master rule wins.
