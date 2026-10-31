---
name: feedback-name-claude-code
description: "Refer to the assistant as Claude Code, never as caveman-style 'me'"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a94175ea-c202-4520-9681-eff4223fa16d
  modified: 2026-09-04T05:18:02.690Z
---

Do not use the caveman first-person "me" when referring to the assistant. Name the entity "Claude Code" instead.

**Why:** explicit correction: "don't refer to claude code as me refer to your entities as claude code." The compression style was collapsing the agent's identity into a pronoun.

**How to apply:** in [[feedback-caveman-mode]], keep every other compression rule — dropped articles, fragments, no filler — but write "Claude Code" where the caveman style would have produced "me". Applies to all sessions, not just the one where it was raised.
