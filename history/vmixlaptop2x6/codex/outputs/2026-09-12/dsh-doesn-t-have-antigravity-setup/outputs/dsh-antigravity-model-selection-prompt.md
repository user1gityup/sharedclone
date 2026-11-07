<!-- Copied 2026-09-15T10:15:42.527Z from ~/Documents/Codex/2026-09-12/dsh-doesn-t-have-antigravity-setup/outputs/dsh-antigravity-model-selection-prompt.md on vmixlaptop2x6 (redacted). -->
# DSH Antigravity-Style Model Selection

Improve DSH so its model-selection experience matches Antigravity’s direct visual setup.

Inspect both Antigravity’s model-selection interface and DSH’s existing provider, model-discovery, configuration, and council-run flows before making changes. Then implement one consolidated model picker in DSH that:

- Displays every supported model, grouped clearly by provider.
- Allows individual model selection.
- Includes **Select all**, **Clear all**, and provider-level selection controls.
- Clearly marks unavailable models and explains the reason, such as a missing credential or disconnected provider.
- Prevents duplicate entries and invalid or empty selections.
- Saves the selected models and restores them when DSH reopens.
- Passes the selection directly into council/run configuration without requiring manual configuration-file edits.
- Preserves DSH’s existing approval gate and does not create any route around it.
- Handles providers being added, removed, unavailable, or temporarily failing.

Follow the repository’s existing architecture and visual conventions. Avoid unrelated refactoring. Add or update appropriate automated tests for model discovery, selection controls, persistence, validation, mixed-provider runs, and unavailable-provider handling.

Build and test the compiled application—not only the source—and exercise the completed model-selection flow end to end. Fix any failures found. Report the files changed, the exact checks performed, their results, and anything that remains untested.

Do not push. Do not change credentials, spend money, or start paid model runs. Commit locally only if the repository’s standing instructions and the current user authorization permit it.
