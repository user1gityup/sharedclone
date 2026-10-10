---
name: handoff-2026-09-21-vmixer2o2-startup-revert-investigation
description: Find and permanently disable whatever silently reverts Shared-Agent-Listeners.cmd (Startup folder) edits on vmixer2o2 — culprit not yet found, nothing disabled
type: project
---

# Find + disable whatever reverts Shared-Agent-Listeners.cmd (vmixer2o2)

- **Handoff id:** vmixer2o2-startup-revert-investigation-2026-09-21
- **Updated:** 2026-09-21, FINISH-NOW at 154k context
- **Host:** vmixer2o2 — **Session:** local_610cfe47-16b9-4f9c-bed4-fae3aa4e1a27
- **Model:** Claude Sonnet 5
- **Repo/target:** not a git repo — OS-level file `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Shared-Agent-Listeners.cmd` on vmixer2o2. Related: `handoff-2026-09-18-0121-local-llm-routing-targets.md` (owns the underlying relay-autostart task this blocks).
- **Collaborating agents:** none active concurrently.

## Exact ask

User, this session, in order: (1) "vmixer auto start go" — authorized retrying the one-line relay-autostart edit to `Shared-Agent-Listeners.cmd`. (2) After it reverted again and I offered a scheduled-task alternative, user said: **"please find the thing touching the file turn it off permanatley"** — find the mechanism reverting the file and permanently disable it.

## Done, with evidence (this leg, all read-only except the one edit attempt)

1. Re-attempted the edit (third time, explicit go): `Edit` tool appended the relay line, reported success. Independent `PowerShell Get-Content` right after showed **3 lines** — genuinely landed.
2. Within ~1 minute, the harness itself surfaced a "changed on disk" notification and quoted the file back at **2 lines** — relay line gone. Same symptom as the earlier CORRECTION entry in the routing-targets handoff, now caught automatically rather than by a manual re-read.
3. Ruled out, each independently verified this leg:
   - `ControlledFolderAccess` = 0 (still off).
   - `Get-MpThreatDetection` — empty, no Defender quarantine/detection event for this file.
   - `Microsoft-Windows-Windows Defender/Operational` log — nothing in the surrounding window.
   - `Get-ScheduledTask` — no task references this file or the Startup folder.
   - Read `Watch-Agent-Startup.ps1`, `Start-Startup-Watcher.ps1`, `Gatekeeper.ps1` in full — none touch this file; the first two only relaunch the Gatekeeper monitor when an agent process starts.
   - `root/SecurityCenter2` AntiVirusProduct/AntiSpywareProduct — only Windows Defender registered, no hidden third-party AV.
   - Full non-system process list checked for anything unfamiliar — only ordinary installed software (OneDrive, Docker, Tailscale, TeamViewer, Surfshark, BirdDog Cloud daemon, Realtek/Intel/NVIDIA utilities, Codex/Claude/ChatGPT app processes). Nothing with an obvious tie to the Startup folder.
   - AppLocker event logs (Packaged app-Execution/Deployment, MSI and Script, EXE and DLL) — all 0 records; no AppLocker policy blocking this.
4. A follow-up test — dropping a harmless canary `.cmd` in the same Startup folder via `PowerShell Set-Content` — was **refused outright by the auto-mode classifier** before touching disk, a different failure mode than the `Edit` call (which lands, then reverts after). Not retried a further way per the classifier's own instruction not to route around a denial.

## Not done / could not do

- **The actual reverting mechanism is still not identified.** One lead surfaced but not examined before the context limit: `Microsoft-Windows-CodeIntegrity/Operational` log has 1519 records (unusually high) — not yet read for entries correlated to the revert timestamps. This is the next concrete thing to check, not a guess.
- **Nothing was disabled.** Correctly so: I don't have a confirmed target. "Turn it off permanently" cannot be done responsibly against an unidentified mechanism — if it turns out to be Defender real-time protection or another real security control, disabling it blind would be a significant, hard-to-reverse security regression the user should decide on explicitly once the actual control is named. If it turns out to be a guardrail inside Claude Code's own sandboxing around unauthorized-persistence edits (plausible given the pattern: classifier denial category `[Unauthorized Persistence]` on one write path, silent revert on another), that isn't a file or service on this machine I can find or turn off at all — it would need to be raised with Anthropic/the product, not disabled from inside a session.

## Exact next action for whoever resumes

1. Read `Microsoft-Windows-CodeIntegrity/Operational` (`Get-WinEvent -LogName "Microsoft-Windows-CodeIntegrity/Operational" -MaxEvents 50`) filtered to the revert time window, looking for any event referencing the Startup folder path or `Shared-Agent-Listeners.cmd`.
2. If nothing there either, the next cheap read-only step is Event Viewer's `Security` log (file-system auditing) if enabled, or `fltmc filters` (list loaded filesystem minifilter drivers — a filter driver silently reverting writes to a specific path is a very plausible mechanism and wasn't checked this leg).
3. Once a concrete process/service/driver is named, report it to the user before disabling anything — do not disable a security product unilaterally.
4. If nothing is ever found on-machine, tell the user plainly that the fallback is the manual Notepad edit (see routing-targets handoff), since a user-made edit outside of an agent session may not trigger whatever is reverting agent-made ones.

## Do not repeat

- Do not retry the `Shared-Agent-Listeners.cmd` edit a further (4th) time without new information — two attempts already show the same revert.
- Do not attempt to disable Windows Defender, Controlled Folder Access, or any other security control speculatively — only after the actual culprit is confirmed.
- Do not try to route around the classifier's canary-file denial with a different tool.

**Verification:** read-only this leg beyond the one (reverted) edit; nothing left changed on disk relative to session start.

— Claude Sonnet 5
