<!-- Copied 2026-09-15T10:15:42.527Z from ~/Documents/Codex/2026-09-12/so/outputs/fix-dsh-completion-reliability.md on vmixlaptop2x6 (redacted). -->
# Fix DSH completion reliability

Work in `~\Documents\claudecode\deepseek-harness`.

Fix DSH pipelines so they produce completed, verified products. Reliability comes before speed. Do not shorten model deadlines.

## Required behavior

- Inspect the latest incomplete records in `~\.dsh\council-runs` and the current council, pipeline, swarm, journal, and review code. Avoid broad unrelated investigation.
- Preserve successful seat answers and completed swarm units. On resume, retry only missing or failed work.
- A swarm is incomplete if any required unit or dependency failed, required files are missing, acceptance conditions were not checked, or available verification failed.
- Do not advance to final review until the swarm has a complete product.
- Partial failures must retain the current stage, artifacts, completed units, and an exact list of remaining work.
- A successful model response is not proof of completion. Verify requested files/artifacts and run available tests or checks.
- Unreachable seats must not block reliable seats. Keep configured planning votes intact; report skipped or failed seats clearly.
- Final review must return `ACCEPTED`, `REWORK REQUIRED`, or `BLOCKED`. Only `ACCEPTED` may produce `Pipeline complete`; rework must remain resumable.
- Preserve all approval gates and spending protections. Do not run paid/live council or swarm calls.

## Verification

Add focused regression tests for:

1. interrupted run resumes without repeating successful calls;
2. partial seat failure;
3. failed swarm unit or dependency;
4. missing files or failed verification;
5. rejected review resumes rework;
6. only verified acceptance completes the pipeline.

Run relevant tests and type checks, rebuild compiled libraries, restart DSH only after checks pass, and verify the running instance serves the new build. Preserve unrelated changes. Do not push.

Report only: root cause, files changed, decisive test/build results, live status, and anything genuinely blocked. Do not claim completion without an end-to-end mocked proof.
