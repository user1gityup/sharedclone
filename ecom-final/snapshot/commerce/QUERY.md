# USER OVERRIDE (2026-10-02) - BUILD NOW, NO SAMPLES
The user said: no samples, just complete it. Paid seats only (OpenAI Codex, Claude, CheaperInference DeepSeek V4 Pro), swarm only, no council, no approvals, headless. This override beats anything below it.
- Do NOT produce design samples, alternatives, or any sample/select/vote step. Build ONE functional implementation.
- Where the text below says "design only", "do not implement", "wait for winning designs", "Do not launch this run until" or "sample/select", ignore that and implement directly with sensible defaults from the brief. No winning designs exist.
- WRITE ROOT: every deliverable file goes into the working directory of this run (~/Documents/claudecode/dsh-runs/build-ecomm-commerce), paths relative to it (src/lib/auth.ts). NOT into ~/Documents/claudecode/commerce and NOT into any "Harness Build" workspace. Ignore "TARGET REPOSITORY" / submit_to below for where files land.
- INPUTS ARE IN THE WORKING DIRECTORY: BUILD-BRIEF.md (the authoritative spec, copy of ~/Documents/claudecode/commerce/BUILD-BRIEF.md) and USERS-CONTRACT.md (the frozen session contract from the built users service: EdDSA Ed25519 JWT, JWKS at /.well-known/jwks.json, claim names, endpoints). Read both first. The storefront verifies tokens against the users JWKS only (env USERS_JWKS_URL, USERS_ISSUER, USERS_AUDIENCE in config/env.example); it never mints user sessions and holds no users private key. Use the 'jose' package for verification.
- Port sources are read-only at absolute paths: ~/Documents/claudecode/billboard-platform and ~/Documents/claudecode/green-energy-platform (middleware.js clientIpFor). Never write there. canna is a separate repo: no shared code, DB or package.
- Stack: Next.js (app router) + TypeScript + Prisma (MySQL). Must pass: install, tsc --noEmit, next build (no DB at build: force-dynamic on DB/cookie/header routes), and node --test tests. Ship tsconfig.json (paths @/* -> ./src/*), next.config.ts, README.md (run/test, env), DEPENDENCIES.md table (name | range | dependency/devDependency | why) - every imported package listed; do NOT write package.json.
- Payments and third-party integrations (POS/ERP/Metrc/rails) run in a mock/sandbox driver by default when keys are absent, so the app starts and is clickable with zero credentials. Seed a demo catalog so the storefront shows products locally.
- No git push, no settings writes, no secret-shaped text.

FINAL PRODUCTION BUILD - PAID / SUBSCRIPTION SEATS ONLY. Do not launch this run until the user has finished picking the winning designs. Its inputs are the selected designs committed under design/paid/ and design/free/ in this repository by the six design sample runs; read the winning design's DESIGN.md, SPEC.md, UX.md, FEATURES.md and IMPLEMENTATION-NOTES.md and build THAT, not a new design. mode `fastest` filters the roster to non-free seats, so the free/local swarm takes no part in production implementation. Divide the build into parallel workstreams wherever the DAG allows - frontend, backend, UI implementation, database, authentication, ecommerce functions, integrations, testing, QA, deployment preparation.

ECOMM BUILD 3 of 3: commerce (Phase 1, merch and general ecommerce). Runs on vmixer2o2 after the users run.

PIPELINE ARGUMENTS, for the chat model driving this run: pass submit_to as `commerce` on EVERY pipeline tool call in this run, including every Continue. It is not stored between calls, and a swarm stage that finishes without it leaves the files uncommitted in staging. Never pass restart.

SPEC: read ~/Documents/claudecode\commerce\BUILD-BRIEF.md in full. It is the authoritative specification for this run; where this message and the brief differ on scope, the brief wins.
Session contract: ~/Documents/claudecode\users\BUILD-BRIEF.md section 3 (EdDSA Ed25519 + JWKS). commerce verifies tokens with the public key from the users JWKS endpoint and can never mint one. Reject any alg other than EdDSA. commerce keeps its own verifier; there is no shared package.
Payments: port billboard's Stripe + Solana devnet PaymentRequest engine from ~/Documents/claudecode\billboard-platform\lib\stripe.js, solana.js, paymentConfirm.js. Also read-only: green-energy-platform\middleware.js clientIpFor.

TARGET REPOSITORY: ~/Documents/claudecode\commerce (writer key `commerce`, branch main).

HOST-COMMIT RULES. The DSH host refuses the WHOLE commit if any unit writes one of these, so no unit may:
- write package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package-lock.json, .npmrc, any .env or .env.* file, anything under .github/workflows/, .husky/ or .githooks/, CLAUDE.md, AGENTS.md, settings.yaml, or any *.pem / *.key file;
- put secret-shaped text in any file, even as an example (sk-..., ghp_..., AKIA..., BEGIN ... PRIVATE KEY). Use placeholders like <SESSION_PRIVATE_KEY_PEM>.
Instead:
- environment variables are documented in config/env.example (NOT .env.example). A pre-written unit in the brief that names .env.example writes config/env.example.
- npm dependencies go in DEPENDENCIES.md at the repository root, one table row per package: name, version range, dependency or devDependency, why. The host turns it into package.json after the run.
- exactly one unit owns each file. Two units writing the same path sinks the submission.
- every path is relative to the repository root (src/lib/auth.ts). Never write into billboard-platform, green-energy-platform or deepseek-harness; they are read-only port sources.
- the host installs, typechecks (tsc --noEmit) and builds (next build) the combined result before it commits, and ONE error anywhere rejects the whole run. So: list every imported package in DEPENDENCIES.md; ship tsconfig.json with paths @/* -> ./src/*; and any page, layout or route that reads the database, cookies or headers must export const dynamic = 'force-dynamic', because the build has no database.

STAGES (swarm only, mode economy): THERE IS NO COUNCIL STAGE. Do not open, request or wait on a council; this run starts at the swarm.
1. swarm planning: the swarm planner derives the collision-free unit DAG for this repository only, following the brief's build order and including the brief's pre-written local units verbatim. Each unit names its files and its acceptance check. No writes, no commands. Stop at the swarm approval gate.
2. swarm: run the approved units, as many in parallel as the DAG allows. Economy mode contests each unit with the FREE seats and reviews with a paid one. Seats enabled on this host: free - Gemini Flash, Gemini Pro, Claude Sonnet, Claude Opus and GPT-OSS (all Antigravity, three signed-in accounts), Free Claude, OpenRouter Free, and Local llama (Qwen3.6 on this machine's GPU, slow but free); paid - Kimi K2, DeepSeek V4, CheaperInference, Claude and OpenAI (Codex). A unit whose provider is not an enabled seat goes to an enabled one.

RESULT: the host commits the winning files on a fresh branch dsh/<seat>/<runId> in the repository, worktree under ~\.dsh\worktrees\<repo>\<runId>. queue-build then reports queue-failed because the origin is a local bare repository, not GitHub. That is expected: the commit stays local on vmixer2o2 and nothing is pushed.

Every seat names its own model (Kimi K2, DeepSeek V3, ...) in anything the user reads. A seat label may accompany the model name, never replace it.