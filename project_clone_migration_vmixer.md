---
name: project_clone_migration_vmixer
description: Clone of ndi2 to the vMixer server - where it stands, the one-click RUN-ALL, what is verified, what is still open
metadata:
  type: project
---

Migration of this machine (`ndi2`, Win11) to the new server **`VMIXER2O2`**, user
`vMixer`, Win10 Pro 19045, 128 GB. State as of 2026-09-11 morning.

**Full detail lives in `~\Documents\claudecode\clone-bundle\HANDOFF.md`**
(also on the USB drive at `\clone\HANDOFF.md`). Read that before touching the
migration. This note is only the pointer and the current position.

- The USB drive (WD easystore) mounts as **`D:` here and `G:` on vMixer**.
- Tooling source of truth: `clone-bundle\` on this machine. Bundle:
  `\clone\claudecode-clone-2026-09-09\`, 31 components (not 32 - old miscount).
- **One click on vMixer: `G:\clone\RUN-ALL.cmd`.** Runs FIX-REPOS, FINISH, FIX-DSH,
  FIX-SECRETS, FIX-FCC, FIX-CLAUDE-SHORTCUT, FIX-GATEKEEPER, SIGN-IN,
  SIGN-IN-SEATS, CHECK in that order, skipping what is done. `-DryRun` prints the
  plan. Each step writes its own log beside it; RUN-ALL writes
  `RUN-ALL-SUMMARY.txt`. FIX-WSL / FIX-VIRTUALIZATION stay manual (admin, reboot).

Verified on vMixer from returned logs: DSH built; Free Claude proxy healthy
(10 models - grows once `free-claude-code\.env` restores from secrets); git
signed in; Antigravity signed in.

Still open when this was written:
- Secrets had not restored - the run kept stalling on bootstrap's Docker/WSL
  prompt. Fixed with `--yes`; not yet confirmed on vMixer.
- PUSHED 2026-09-10: `deepseek-harness` `0a5600ab` via the PowerShell gatekeeper
  on vMixer, user-approved after full-diff review (44 files, no secrets). Remote
  `feat/heterogeneous-teammates` confirmed at `0a5600ab` from ndi2. The queue
  entry in THIS machine's `push-requests.md` still reads `Status: open` - the
  gatekeeper that pushed ran against vMixer's copy of the brain. This machine is
  one commit further (`0a372eed`, multi-account seat pool) - not queued.
- RUN-ALL result on vMixer: NOT YET SEEN from ndi2.

**2026-09-11 - `G:\clone\MEND-ALL.cmd` is on the drive, not yet run on vMixer.**
The user hit two faults signing in there: Claude desktop asked to trust
the old machine's user folder, ndi2 (desktop-claude's nested session archives were unpacked with
no rewrite - 97 session `cwd`s still named ndi2), and Antigravity showed no
history (`~/.gemini/antigravity` was never packed). MEND-ALL restores the history
from a new `antigravity-history.tar.gz` and rewrites the old user name across
every restored app folder, shortcut and user environment variable, with backups.
Proven on ndi2 against the real bundle: `mend-selftest.mjs` 32/32, wrapper test
exit 0. Whether Antigravity's UI lists the restored conversations can only be
seen on vMixer. Details, and the three source fixes still owed to
bootstrap/pack/CHECK, are in HANDOFF.md "Round 4". Every tool on the drive now
matches `clone-bundle\` byte for byte (checked 2026-09-11).

**MEND-ALL ran on vMixer with no errors (user, 2026-09-11).**

**The brain itself is now a git repo** shared by both machines. Pushed from ndi2
(`298fe11`, then `cee4c44`). vMixer has NOT joined yet.

**2026-09-11 afternoon - one click again: `G:\clone\RUN-ALL.cmd`.** Per
[[feedback_one_click_bundling]], MEND-ALL (step 2b, skips on a clean mend report)
and JOIN-BRAIN (step 8b, `-NoPrompt`, skips once the brain is a git repo) are now
RUN-ALL steps, and its closing summary names brain commits waiting for the push
cue. Tested on ndi2 (HANDOFF "Round 6") and copied to the drive, hash-verified.
Human-only on vMixer after the click: look at Antigravity's conversation list,
say the push cue in a Claude Code session there if the summary asks, bring the
drive back with `RUN-ALL-SUMMARY.txt` and `JOIN-BRAIN-LOG.txt`.
See [[shared-memory-protocol]].

**Why:** the user wants to finish vMixer with as little hands-on work and as few
tokens as possible, across fresh sessions.

**How to apply:** prefer driving vMixer through a Claude Code session there over
more USB round trips - Remote Control is connected on this account, so a
session opened on vMixer shows up in `ListAgents` and takes `SendMessage`.
vMixer's shared brain is the 2026-09-09 restore and does NOT contain this note
until it joins the brain repo, so until then brief that agent in the message
itself. See [[git-gatekeeper-agent]],
[[dsh-harness-gotchas]], [[free-claude-code-setup]].

**DSH code parity (2026-09-12):** the brain does not carry the harness checkout. `Desktop\UPDATE-DSH.cmd` (installed from `.sync/UPDATE-DSH.cmd` wherever ~/.dsh exists) syncs the brain, fast-forwards and rebuilds deepseek-harness, and restarts DSH. Push requests carry `Host:`; each PowerShell gatekeeper leaves other machines' requests alone.

**DSH records cross machines (2026-09-11):** once vMixer joins through RUN-ALL, the next session start or DSH launch collects its existing council-runs JSON records, including runs saved before joining, into [[dsh-runs]]; digest facts go into [[dsh-memory]]. The collector needs no harness rebuild. Records reach other machines after a brain push from vMixer and their next sync. Immediate save/digest sharing additionally needs the updated harness rebuilt and loaded there. vMixer joining and the return of its saved run remain unverified. See [[handoff_dsh_brain_wiring]].
