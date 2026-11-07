---
name: feedback_qa_pictures_submit
description: Q&A with pictures - widget with picture options whose Confirm button submits the answer at once via sendPrompt
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7c2c10ee-0f05-482b-941c-810ccf1f2169
  modified: 2026-10-25T16:17:18.464Z
---

When a Q&A question needs pictures, render it as a show_widget panel: "Question X of Y · Z remaining", picture per option A-D, recommended first and preselected, one "Confirm and continue" button (last question "Confirm") that calls sendPrompt with the answer text immediately. Don't add a second AskUserQuestion card for the same question.

**Why:** User (2026-10-25) asked for pictures in the Q&A, then "make confirm and continue button submit answer now and in future". The sendPrompt Confirm button did submit ("Q3 bulb light: A, both places" arrived from it).
**How to apply:** Picture questions use this widget; plain questions keep AskUserQuestion. Act on each answer as it arrives and show the next question at once. Related: [[feedback_charts_in_chat_not_files]].
