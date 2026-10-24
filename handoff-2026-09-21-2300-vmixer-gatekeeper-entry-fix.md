---
name: handoff-2026-09-21-2300-vmixer-gatekeeper-entry-fix
description: 2026-09-21 found and closed a malformed push-requests.md entry that was silently invisible to both queue parsers; underlying format bug still open
type: project
---

# Malformed gatekeeper queue entry — found, closed as stale; parser bug still open

- **Handoff id:** vmixer-gatekeeper-entry-fix-2026-09-21
- **Created:** 2026-09-21 23:00 local
- **Host:** ndi2
- **Session:** e68c9ff8-1b6e-43e4-b50a-977c0b812756
- **Model:** Claude Sonnet 5
- **Project:** `~/.claude/shared-brain` (push-requests.md); read-only investigation of
  `~/Documents/claudecode/deepseek-harness` (git only, no file edits there)
- **Collaborating agents:** none this leg

## Exact ask

User (chat): "there is a gatekeeper push on vmixer that has been addressed to
this machine can you investigate that and fix." Follows on from the earlier
vmixer2o2 session's unresolved investigation into "gatekeeper is still writing
for ndi machine" (see `handoff-2026-09-21-1640-vmixer2o2-fleet-checkin.md`,
"2026-09-21 (new session)" section) — this leg finally found the real defect
behind that complaint.

## Done, with evidence

1. Read `push-requests.md` in full (736 lines at the time). Found one entry at
   the old lines 601-607, filed 2026-09-19T12:10:00Z by "DeepSeek-V4 (via DSH)",
   `Host: ndi2`, sitting directly under the `## ~\Documents\
   claudecode\deepseek-harness` entry (Host: vmixer2o2, filed 2026-09-18, closed
   `pushed 2026-09-21`) — **with no `## <repo> — <branch>` heading of its own**.
2. Confirmed via source read this is a real parser defect, not cosmetic:
   - `Gatekeeper.ps1` `Get-Requests` (line 63): `[regex]::Matches($body, '(?ms)^##
     ([^\r\n]+)\r?\n(.*?)(?=^## |\z)')` — splits strictly on lines starting
     `## `. An entry without that heading is captured as trailing text of the
     *previous* `## `-headed entry, not as its own match.
   - `queue-build.mjs` `queueBuild` (line 75): `text.slice(marker)...split(/(?=^##
     )/m)` — identical behavior, used for its append-time duplicate check.
   - Net effect: this DeepSeek-V4 request was **never visible to either
     parser** as an open item. It silently rode along inside the vmixer2o2
     entry's body. Because that host entry's own `Status:` was already
     `pushed`, `Get-Requests` filtered the merged blob out entirely (status
     check happens on `$statuses[-1]`, which is the vmixer2o2 entry's own
     line) — so this is very likely the literal thing the user (and the
     earlier vmixer2o2 session) were seeing: a request "on vmixer['s entry]"
     that reads `Host: ndi2` inside it.
3. Verified the request's own content is stale, not just mis-filed: in
   `deepseek-harness` (`~\Documents\claudecode\deepseek-harness`,
   local HEAD `330c546de392ef4f9d48331c7be34c5379cc0403`), ran
   `git merge-base --is-ancestor d47a374525 HEAD` and `... origin/feat/
   heterogeneous-teammates` (after `git fetch origin`) — **both exit 0**. The
   commit already landed on origin long ago via a later push in this same
   branch's history.
4. Fixed in `push-requests.md`: added the missing `## ~\Documents\
   claudecode\deepseek-harness — feat/heterogeneous-teammates` heading directly
   above the entry, and closed it `Status: skipped 2026-09-21 by Claude Sonnet
   5` with the ancestry evidence above, following the same pattern many prior
   entries in this file already use for stale/superseded requests (a
   non-gatekeeper session verifying ancestry and marking `skipped`, never
   running `git push`). No git command beyond read-only `rev-parse`,
   `merge-base --is-ancestor`, `fetch`, `status`, `log` was run; nothing pushed.

## Not done — the underlying format bug is still live

Neither `Gatekeeper.ps1` nor `queue-build.mjs` was changed. Today's entry is
fixed by hand, but **any future entry filed without its `## ` heading (a
hand-typed one, or a DSH/agent path that skips `queueBuild` and appends raw
text) will disappear the same way**, silently merging into whatever `## `
section precedes it in the file, with no error and no visibility. A proper fix
would make at least one of:
- `queue-build.mjs`'s append path refuse to write anything that doesn't
  round-trip through its own entry template (it already builds the string
  itself at line 66, so this mainly protects against *other* filers appending
  by hand without the header — which is exactly what produced this case, per
  the "Filed: ... by DeepSeek-V4 (via DSH)" phrasing suggesting a hand-crafted
  append rather than a `queueBuild()` call).
- `Get-Requests`/the split in `queue-build.mjs` detect and surface a body
  region that isn't inside any `## `-headed match (e.g., compare the sum of
  matched entries' spans against the full body length after the marker, and
  throw/warn on a gap) — this would have caught the exact byte range that went
  missing here.

Not built this session — new-scope work, and this session hit a context-size
FINISH-NOW immediately after finding and closing the stale entry.

## Exact next action

1. Tell the user (done in this session's chat reply) what was found and
   closed, and that the parser-bug fix above is still open if they want it
   built.
2. If they want the parser hardening built: pick one of the two approaches
   above (the gap-detection approach in `Get-Requests`/`queue-build.mjs` is
   the smaller, most direct fix — it only needs to compare `$body.Length`
   against the sum of matched entries' lengths, or track `LastIndex` across
   matches, and throw/warn once). Add a fixture case to whatever local test
   harness exercises `Gatekeeper.ps1 -ReviewOnly`/`queue-build.mjs` today
   before shipping it.
3. No push needed for the `push-requests.md` edit itself — it's shared-brain
   content, not a code change; it syncs via the normal brain-sync cycle like
   any other note.

## Verification

- `git -C deepseek-harness merge-base --is-ancestor d47a374525 HEAD` → exit 0.
- `git -C deepseek-harness merge-base --is-ancestor d47a374525
  origin/feat/heterogeneous-teammates` (after `git fetch origin`) → exit 0.
- Read both parser source files in full for the split-regex behavior claim
  above; not just inferred from symptoms.

## Do not repeat

- Do not treat "Status: skipped" entries like this one as needing a push —
  they never needed one; the commit was already on origin.
- Do not assume the parser bug is fixed — only this one instance was corrected
  by hand. A grep of `push-requests.md` for entries lacking a `## ` heading
  before their next `## ` would be the fast way to check for more of them if
  the user reports this symptom again elsewhere in the file.

— Claude Sonnet 5

## Session 2026-09-21 23:35 — parser fix attempted, blocked by a live revert

- **Updated:** 2026-09-21 23:35 local
- **Host:** ndi2
- **Session:** fdce6ae9-0f1e-46ec-9c7e-53d83f0716bc
- **Model:** Claude Sonnet 5
- **Ask:** user resumed this handoff by pasting its filename; asked whether to
  build the parser hardening described above. User chose (via AskUserQuestion)
  "Build the gap-detection fix" for the missing-`## `-heading defect.

### Done, with evidence

1. Read `Gatekeeper.ps1`, `queue-build.mjs`, `queue-build.test.mjs`,
   `Test-Gatekeeper.ps1`, `Test-GatekeeperSourceBranch.ps1`, `README.md`,
   `STATUS.md` in
   `~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/`
   in full.
2. Worked out why a literal "span vs. body length" gap check (as the prior
   session's note phrased it) would **not** actually catch this bug: the
   regex `(?ms)^## ([^\r\n]+)\r?\n(.*?)(?=^## |\z)` is lazy but still
   contiguous — a heading-less entry gets swallowed into the *previous*
   match's body, leaving no unmatched byte range to detect. The real,
   checkable signature of the corruption is that the entry template
   (`queue-build.mjs` line 66) puts exactly one `Filed: ` line right after
   each entry's own `## ` heading — so more than one `Filed: ` line inside a
   single matched/split entry means a second request is hiding inside it.
3. Implemented that check in both places:
   - `Gatekeeper.ps1` `Get-Requests`: added a `$filedLines.Count -gt 1` throw
     **before** the existing `Status -ne 'open'` filter (this is required —
     the real corrupted entry was hidden inside an entry whose own `Status`
     was already `pushed`, so a check placed after that filter would have
     kept missing exactly this case).
   - `queue-build.mjs` `queueBuild`: added the same `Filed: ` count check
     over the `entries` array, thrown before the duplicate check, so a future
     automated filer refuses to append into an already-corrupted queue file.
4. Confirmed via `diff` against the auto-generated
   `Gatekeeper.ps1.pre-brain-sync-2026-09-21T23-32-35-045Z` backup that my
   edit *was* written to disk correctly at 23:32:35 local — the backup file
   is my edited version (diff shows only my added lines as the delta).

### Blocked — do not repeat blindly re-editing

**Both edited files were silently reverted back to their pre-edit content
within about 2 seconds of being saved**, on this machine, with no agent
action in between. Evidence:
- `Gatekeeper.ps1` and `queue-build.mjs` on disk right now do **not** contain
  either check (confirmed by re-reading both after the edits).
- New backups appeared at the same moment the edits landed:
  `Gatekeeper.ps1.pre-brain-sync-2026-09-21T23-32-35-045Z` (16380 bytes, i.e.
  it captured *my edited* version) and a same-pattern `queue-build.mjs`
  backup. The live files were then overwritten with a version lacking the
  edits.
- This is **not** `~/.claude/shared-brain/.sync/brain-sync.mjs` — I read
  `.sync/README.md` in full; that sync only touches `~/.claude/shared-brain`
  itself (notes, `push-requests.md`, secrets, `fleet.mjs` repos), not
  `~/Documents/Codex/2026-09-07/.../outputs/gatekeeper/`. The
  `.pre-brain-sync-<stamp>` naming matches the convention `.sync/README.md`
  documents for *brain-secrets key* backups specifically, not for this
  directory, so something else is reusing that naming pattern here — source
  not yet identified.
- Two earlier backup pairs exist from 2026-09-14 and 2026-09-18 with the same
  naming, so this reverting behavior is not new today; it has been silently
  discarding edits to these two files for at least a week. Whatever edits
  produced those two earlier backups never survived either — worth checking
  later whether anything of value was lost in those (not investigated this
  session; ran out of context budget).
- Hit the 151k-token QUOTA HANDOFF - FINISH NOW trigger immediately after
  spotting the second revert (queue-build.mjs), stopped investigating there.

### Exact next action

1. Find what reverts `Gatekeeper.ps1` / `queue-build.mjs` in this directory.
   Candidates to check first: a Windows Scheduled Task, `Start-Startup-Watcher.ps1`
   / `Watch-Agent-Startup.ps1` (both live in this same folder — read them,
   they were not read this session), a OneDrive/cloud-sync client silently
   restoring from a synced copy, or a `fleet.mjs repos` entry (in
   `~/.claude/shared-brain/.sync/fleet.json` or similar) that treats this
   Codex output directory as a followed repo and fast-forwards it from
   elsewhere. `Get-Process`, `Get-ScheduledTask`, and grepping
   `~/.claude/shared-brain/.sync/fleet.mjs`'s repo list for this path are the
   fastest checks.
2. Once the reverting process is identified: either pause it for the edit
   window, or make the edit at its actual source of truth (if it is pulling
   from a git remote or another host's copy) instead of the live file here.
3. Re-apply the two edits (they are fully designed and correct — see "Done"
   above; can be re-typed from this note's description or from the
   `.pre-brain-sync-2026-09-21T23-32-35-045Z` backup pair, which hold the
   exact intended content) once the revert source is neutralized.
4. Add the fixture regression test — not yet written this session. Plan: a
   `node --test` case in `queue-build.test.mjs` that seeds a queue file with
   one entry containing two `Filed: ` lines (simulating the missing-heading
   corruption) and asserts `queueBuild` rejects it; and a PowerShell fixture
   (new file, or added to `Test-GatekeeperSourceBranch.ps1`'s pattern using
   `-ReviewOnly`) asserting `Gatekeeper.ps1` throws on the same fixture.
5. `push-requests.md` itself is fine (verified again this session, unchanged
   from the prior session's fix) — this whole leg is only about the parser
   hardening, not the queue content.

### Do not repeat

- Do not re-edit `Gatekeeper.ps1` / `queue-build.mjs` again without first
  finding and neutralizing whatever reverts them — a third blind edit will
  almost certainly just produce a third silently-discarded backup.
- Do not assume `.sync/brain-sync.mjs` is the culprit; it was read in full
  and does not touch this directory.

### Likely related open case — read this first

`shared-agent-log.md` records the **same symptom** on `vmixer2o2` against a
different file (`Shared-Agent-Listeners.cmd`, Startup folder): an edit that
reads back correctly, then silently reverts within about a minute, with
Defender/AppLocker/ControlledFolderAccess/scheduled-tasks all ruled out by a
full read-only investigation. See
`handoff-2026-09-21-vmixer2o2-startup-revert-investigation.md` — also still
unsolved. Two machines, two unrelated files, same revert-with-no-visible-actor
shape; worth investigating as one phenomenon rather than two, and worth
checking whether it is host-specific (ndi2 vs vmixer2o2) or something in the
Claude Code harness/session layer common to both.

— Claude Sonnet 5

## Session 2026-09-21 (new leg) — revert source IDENTIFIED, fix not yet reapplied

- **Updated:** 2026-09-21 local (session opened by pasting this handoff's filename)
- **Host:** ndi2
- **Session:** c21c5c10-981c-4421-94a3-40ec81d27aac
- **Model:** Claude Sonnet 5
- **Ask:** resume this handoff's exact next action — find what reverts
  `Gatekeeper.ps1` / `queue-build.mjs`.

### Done, with evidence — root cause found

1. Read `~/.claude/shared-brain/.sync/brain-sync.mjs` (`install()`, lines
   715-770 and 1744) and `.sync/fleet.mjs` in full.
2. `install(dir, options)` (called by `context()` at line 1744, which is called
   by `cycle()`) contains this exact block:
   - `GATEKEEPER_DIR = ['Documents','Codex','2026-09-07','can-you-check-the-agent-history','outputs','gatekeeper']`,
     `GATEKEEPER_FILES = ['Gatekeeper.ps1', 'queue-build.mjs']` (lines 703-704).
   - For each file, it compares the **live deployed copy** in that directory
     against the **canonical copy stored in the brain** at
     `~/.claude/shared-brain/.sync/gatekeeper/<name>`. If they differ
     (CRLF/LF-insensitive), it writes `${target}.pre-brain-sync-<stamp>` as a
     backup of the live file, then **overwrites the live file with the brain's
     canonical copy** (lines 744-770). This is the literal source of the
     `.pre-brain-sync-<timestamp>` backups.
3. Confirmed the trigger cadence: `~/.claude/hooks/SharedBrainListener.ps1` is
   installed to the Windows Startup folder (also by `install()`, lines
   775-799) and runs continuously, mutex-guarded to one instance
   (`Local\SharedBrainContinuousSync`), looping every
   `[Math]::Max(10, $IntervalSeconds)` (default 20s) and calling
   `node brain-sync.mjs cycle --dir <brain> --timeout 120000` each time. `cycle()`
   calls `context()` which calls `install()` every cycle — so any live edit to
   either gatekeeper file is reverted within one listener tick (~10-20s; the
   prior session observed ~2s, likely a second trigger such as a session-start
   `context` call landing in between).
4. Verified live: `~/.claude/shared-brain/.sync/gatekeeper/Gatekeeper.ps1` is
   **15523 bytes**, byte-identical to the current un-fixed live file, and does
   **not** contain the `Filed:`-count parser-hardening check designed and
   applied (then reverted) in the prior session. This is why every cycle keeps
   stamping the live file back to the un-fixed version: the brain's own
   canonical copy was never updated.

### Not done

- The parser-hardening fix (design fully described in the prior session's
  entry above: check `Filed:` line count > 1 per matched entry, thrown before
  the `Status` filter, in both `Gatekeeper.ps1` `Get-Requests` and
  `queue-build.mjs` `queueBuild`) has **not been reapplied**. Session hit a
  159k-token QUOTA HANDOFF - FINISH NOW immediately after confirming the root
  cause; stopped before re-editing anything, per this file's own "do not
  repeat blindly re-editing" guidance from the prior session.
- No test/fixture added yet (`queue-build.test.mjs` case + PowerShell fixture,
  as prior session planned).

### Exact next action

1. Apply the fix to **both** locations so the revert loop cannot undo it:
   - The canonical copy in the brain: `~/.claude/shared-brain/.sync/gatekeeper/Gatekeeper.ps1`
     and `~/.claude/shared-brain/.sync/gatekeeper/queue-build.mjs`.
   - The live deployed copy in `~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/`
     (same two filenames) — editing only this one is what silently failed
     twice already; it is not the source of truth `install()` reads from.
   - Editing the brain copy alone is also insufficient until the next listener
     cycle re-deploys it; edit both in the same breath, or edit the brain copy
     and then run `node ~/.claude/shared-brain/.sync/fleet.mjs` install path
     (or just wait ~20s for the listener) to deploy it, then verify the live
     file picked it up.
2. The intended patch content: add a `Filed:` line-count check (>1 throws)
   before the `Status -ne 'open'` filter in `Get-Requests` (`Gatekeeper.ps1`),
   and the equivalent check over the `entries` array before the duplicate
   check in `queueBuild` (`queue-build.mjs`). Exact rationale for placement:
   see the prior session's "Done, with evidence" item 2-3 above.
3. Add the fixture regression test (`queue-build.test.mjs` case + a PowerShell
   fixture) before considering this closed, per prior session's plan.
4. This is shared-brain + local gatekeeper tooling, not project code under
   version control the normal way — no git push involved; `.sync/gatekeeper/`
   syncs to other machines via the brain's own git remote once committed
   there.

### Do not repeat

- Do not edit only the live deployed file in the Codex `outputs/gatekeeper/`
  directory — the background listener (`SharedBrainListener.ps1`, ~20s cycle)
  will silently revert it from the brain's stale canonical copy at
  `.sync/gatekeeper/<name>` every time. Edit both copies together.
- Do not assume killing/pausing the listener is required if both copies are
  edited together — since `install()` only overwrites when the two differ, an
  edit applied to both at once is a no-op for `install()` and nothing reverts.
  (Not yet tested this session, since no edit was made — verify this
  assumption when actually applying the fix.)
- Do not re-investigate the revert source again; it is confirmed via direct
  source read of `brain-sync.mjs`, not inferred from symptoms.

— Claude Sonnet 5

## Session 2026-09-21 16:52 — parser fix reapplied and self-healed; tests written, not yet run

- **Updated:** 2026-09-21 16:52 local
- **Host:** ndi2
- **Session:** 7cdfe729-50d6-4fe2-aa4f-ad054f20e4b1
- **Model:** Claude Sonnet 5
- **Ask:** user resumed this handoff by pasting its filename again; continued
  the prior leg's exact next action (reapply the `Filed:`-count fix to both
  the brain canonical copy and the live deployed copy at once).

### Done, with evidence

1. Read both live files (`~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/{Gatekeeper.ps1,queue-build.mjs}`)
   and both brain canonical copies (`~/.claude/shared-brain/.sync/gatekeeper/{Gatekeeper.ps1,queue-build.mjs}`)
   in full; confirmed all four were still the un-fixed version.
2. Edited all four in one batch with the same patch: a `Filed:`-line-count
   check (`>1` throws) added in `Gatekeeper.ps1` `Get-Requests` before the
   `Status -ne 'open'` filter, and the equivalent check over the `entries`
   array in `queue-build.mjs` `queueBuild` before the duplicate check — exact
   design from the prior session's "Done, with evidence" item 2-3.
3. **Caught the revert loop live, in the act, for the first time**: right
   after the edit batch, a tool-level "file changed on disk since you last
   read it" notice fired for the live `queue-build.mjs`, showing it had
   already been reverted back to the un-fixed version within the same
   turn — direct, real-time confirmation of the `SharedBrainListener.ps1` /
   `brain-sync.mjs install()` mechanism the prior session diagnosed from
   source alone.
4. Confirmed via `Get-CimInstance Win32_Process` that both
   `SharedBrainListener.ps1` (PID 8528) and the actual gatekeeper monitor
   `Gatekeeper.ps1 ... ` itself (PID 25388, no `-ReviewOnly`/`-Once`) are
   running live on this host right now. **New fact not in prior sessions**:
   the long-running monitor process has the old script body loaded in
   memory (PowerShell doesn't hot-reload a running script), so even after
   the on-disk fix lands and sticks, that specific running instance won't
   enforce the new check until it is restarted — only a fresh invocation
   (e.g. `-ReviewOnly`, or a future monitor start) picks it up. Not acted on
   this session (no process was killed/restarted); flagged for next action.
5. Re-read all four files after the revert: brain canonical copies of both
   files held the fix; live `Gatekeeper.ps1` held the fix; live
   `queue-build.mjs` did not. Re-applied the identical patch to live
   `queue-build.mjs` alone (canonical already matched) — the Edit tool
   refused once ("file changed on disk since you last read it"), so it was
   re-read, then found **already self-healed** to the fixed version (the
   listener had since deployed the now-fixed canonical forward). Confirms
   the prior session's untested assumption: editing both copies together
   converges (the listener may still race and revert the live copy once,
   but the very next cycle re-deploys the correct, now-fixed canonical, so
   the fix survives without needing to pause the listener).
6. Verified final on-disk state of all four files matches (read back
   `Gatekeeper.ps1` lines 58-72 and `queue-build.mjs` lines 70-84 in both
   locations): all four carry the identical `Filed:`-count check.
7. Added the fixture regression tests planned by the prior session:
   - `queue-build.test.mjs`: new test `'refuses to append when a queue entry
     is missing its own heading'` — seeds a queue with a two-`Filed:`-line
     merged entry (simulating the exact 2026-09-19 corruption shape) and
     asserts `queueBuild` rejects with `/Corrupted queue entry/`.
   - `Test-GatekeeperSourceBranch.ps1`: new fixture block before the final
     `Write-Host 'ALL SOURCE-BRANCH TESTS PASSED.'` — builds the same
     two-`Filed:`-line merged entry, runs the monitor `-ReviewOnly` against
     it, and asserts a non-zero exit with `Corrupted queue entry` in the
     output.
   (Test files are not in `brain-sync.mjs`'s `GATEKEEPER_FILES` list, so they
   are not subject to the revert loop; edited once, live, no canonical copy
   needed.)

### Not done — hit FINISH-NOW before running anything

- **The new tests have not been run.** Hit the 150k-token QUOTA HANDOFF -
  FINISH NOW trigger immediately after finishing the `Test-GatekeeperSourceBranch.ps1`
  edit, before executing either test file. Per this project's own standing
  rule ("test it yourself before you tell me to do anything" / "an untested
  fix is not finished work"), **this fix must not be reported as complete
  until both are actually run and shown green.**
- The always-running gatekeeper monitor process (PID 25388 as of this
  session; may differ next session — re-check with the `Get-CimInstance`
  command in item 4 above) has not been restarted, so it is still enforcing
  the old, unfixed parser in memory even though the file on disk is correct.

### Exact next action

1. Run, in order, and read full output/exit codes (not just a trailing
   summary):
   - `cd "~\Documents\Codex\2026-09-07\can-you-check-the-agent-history\outputs\gatekeeper"; node --test queue-build.test.mjs`
   - `cd "~\Documents\Codex\2026-09-07\can-you-check-the-agent-history\outputs\gatekeeper"; powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-GatekeeperSourceBranch.ps1`
2. If either fails, fix the regex/logic (most likely culprit: PowerShell
   here-string `` `n `` escaping in the new fixture block, or an off-by-one
   in the `Filed:` count against the existing pushed-vmixer2o2-entry style
   fixtures already in the file) and re-run — do not report done on a guess.
3. Re-verify no revert happened to the two source files during/after the
   test run (`Get-Content` the four-file set, or re-`Read` them) — the
   listener is still cycling every ~20s in the background throughout.
4. Once both suites are green: consider restarting the live gatekeeper
   monitor process (PID noted in item 4 of "Done" above) so the running
   instance actually enforces the new check — ask the user before killing
   it, since it may be mid-review of something. This was not done or asked
   about this session.
5. Tell the user the fix is now live, tested, and (if restarted) enforced by
   the running monitor. Nothing here needs the PowerShell gatekeeper queue —
   this is local tooling, not a versioned repo push.

### Verification

- Direct before/after `Read` of all four files (brain canonical + live, both
  scripts) confirming identical fixed content, post-self-heal.
- `Get-CimInstance Win32_Process -Filter "Name='powershell.exe' or
  Name='pwsh.exe'"` → confirmed `SharedBrainListener.ps1` (8528) and
  `Gatekeeper.ps1` (25388, live monitor, no test flags) both running.
- Test files edited but **not executed** — do not count this as verified;
  see "Not done" above.

### Do not repeat

- Do not report this fix as done/shipped without first running both new
  test files and quoting their real exit codes/output.
- Do not assume the live monitor process enforces the fix just because the
  file on disk is correct — it was started before the fix landed and won't
  pick it up without a restart (PowerShell scripts aren't hot-reloaded).
- Do not re-diagnose the revert loop; it was directly observed live this
  session on top of the prior session's source-level confirmation.

— Claude Sonnet 5

## Session 2026-09-21 (new leg) — CLOSED: real bug found, fixed, tested green, monitor restarted

- **Updated:** 2026-09-21 local
- **Host:** ndi2
- **Session:** e68c9ff8-1b6e-43e4-b50a-977c0b812756 (continued in-session after a
  QUOTA HANDOFF - PREPARE trigger at 103k tokens; not a new session)
- **Ask:** user resumed this handoff by pasting its filename; ran the two test
  suites the prior session had written but never executed.

### Done, with evidence

1. Ran `node --test queue-build.test.mjs`: **10 pass, 1 fail** — the new
   fixture `'refuses to append when a queue entry is missing its own
   heading'` failed with `AssertionError: Missing expected rejection`.
2. Root-caused it by reading `queue-build.mjs` line 79: `entries.find(e =>
   (e.match(/^Filed: /m) || []).length > 1)` — **`.match()` without the `g`
   flag only ever returns the first match** (array of length 1, or `null`),
   so `.length > 1` can never be true regardless of how many `Filed:` lines
   exist. The check the prior session designed and wrote was silently inert
   from the moment it was typed — a JS-specific bug, not present in the
   `Gatekeeper.ps1` side (`[regex]::Matches()` in .NET always returns every
   match, no flag needed — confirmed by reading `Gatekeeper.ps1` lines 64-72,
   which is correct as written).
3. Fixed by changing the regex to `/^Filed: /gm` in both copies at once (same
   two-copy pattern as before, to avoid the brain-sync revert loop):
   - `~/Documents/Codex/2026-09-07/can-you-check-the-agent-history/outputs/gatekeeper/queue-build.mjs:79`
   - `~/.claude/shared-brain/.sync/gatekeeper/queue-build.mjs:79`
   `Gatekeeper.ps1` was not touched (it had no bug).
4. Re-ran `node --test queue-build.test.mjs` → **11/11 pass**.
5. Ran `powershell -File .\Test-GatekeeperSourceBranch.ps1` → **all 9 fixtures
   PASS**, including `"Heading-less merged entry is refused, not silently
   dropped"`, ending `ALL SOURCE-BRANCH TESTS PASSED.`
6. Re-read all four files (live + brain-canonical, both scripts) after both
   test runs via `grep` — all four still hold the fix; no revert this leg
   (expected: `Gatekeeper.ps1` was never touched this leg so brain vs. live
   never differed on it, and `queue-build.mjs`'s two copies were edited
   together as before).
7. Checked live processes: `SharedBrainListener.ps1` (PID 8528) and the
   gatekeeper monitor were both still running; the monitor was still the
   **same PID 25388** from the prior session — i.e. still running the
   pre-fix script body in memory (PowerShell doesn't hot-reload).
8. Asked the user via AskUserQuestion whether to restart the monitor
   (mid-review risk); user chose "Yes, restart it now".
9. Found the real launcher: the Startup-folder shortcut `Gatekeeper Startup
   Watcher.lnk` runs `Watch-Agent-Startup.ps1`, which auto-launches
   `Gatekeeper.ps1` via `Start-Process -FilePath powershell.exe -ArgumentList
   @('-NoProfile','-STA','-WindowStyle','Hidden','-File','"<path>"')
   -WorkingDirectory <gatekeeper dir>` whenever it detects a new agent
   process AND the mutex `Local\SharedUserGitGatekeeper` isn't held. Read
   `Watch-Agent-Startup.ps1` in full rather than guessing the launch command.
10. `Stop-Process -Id 25388 -Force`, then replicated that exact `Start-Process`
    invocation directly. New monitor came up as **PID 25412**. Confirmed via
    `Get-CimInstance` that it's running with the identical command line,
    now backed by the fixed on-disk script.

### Verification

- `node --test queue-build.test.mjs` → 11 pass / 0 fail (real second run,
  after the fix, output quoted above).
- `Test-GatekeeperSourceBranch.ps1` → `ALL SOURCE-BRANCH TESTS PASSED.` with
  the new fixture's PASS line shown explicitly.
- `grep` re-read of all four files post-fix, post-test — fix present in all.
- `Get-CimInstance Win32_Process` before and after the restart, showing the
  PID change 25388 → 25412 and the new process's command line.

### Status: CLOSED

Both parser hardening checks (JS and PowerShell) are now correct, tested
green, live on disk in both the working copy and the brain canonical copy,
and enforced by a freshly restarted monitor process. Nothing further open on
this handoff. `push-requests.md` itself was already fine (verified in an
earlier leg) — no git push involved anywhere in this thread; it's local
gatekeeper tooling plus a shared-brain note, not a versioned repo change.

### Do not repeat

- Do not assume a `>1`-count check written against a JS `.match()` call is
  correct without checking for the `g` flag — `.match()` silently degrades
  to "first match only" without it, with no error, no warning, and a
  perfectly plausible-looking `.length` property on the result.
- Do not restart the gatekeeper monitor without asking first if it might be
  mid-review — this leg asked and got explicit approval before killing
  PID 25388.

— Claude Sonnet 5
