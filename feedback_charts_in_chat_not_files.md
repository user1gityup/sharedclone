---
name: feedback_charts_in_chat_not_files
description: Charts and status go in the chat window itself; never create or send a file the user did not ask for
metadata:
  type: feedback
---

When the user asks for a chart or a status, put it in the conversation window. Use an inline widget, and if that might not render, a Markdown or text chart in the reply. Never write an HTML or other file and send it with SendUserFile unless they ask for a file.

**Why:** 2026-10-19 the user asked "where is my chart". Claude Opus 5.5 wrote agent-status-1207z.html and sent it as a file. The user said: "don't send as a file ... put it in this window don't do things without permission stick to rules." The file was deleted on their answer.

**How to apply:** status and chart requests get a text chart in the reply, plus an inline widget where it helps. See [[nothing-without-permission]] and [[feedback_selectable_choices]].
