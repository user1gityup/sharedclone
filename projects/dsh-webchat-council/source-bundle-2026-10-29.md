# DSH WebChat & Council — verifiable source bundle

PM P-735a01cf. This is portable source for a local LLM / verified-free Claude implementer, not deployed integration. Each named file follows in a fenced code block. Copy into the indicated relative path. Run `npm test`.

Known limitation: DeepSeek DOM selectors are UNVERIFIED; OpenClaw gateway port must be mapped to the existing DSH bridge. Do not use paid API fallback.

## `README.md`

```markdown
# DSH WebChat + DeepSeek Council — code handoff (starter, not deployed)

**PM project:** P-735a01cf. **User's direction:** send code to PM; a verified local LLM or verified-free Claude will adapt/implement it. Do not select paid model seats.

## What's actually implemented in this package

- `src/contracts.ts`: typed interface to the EXISTING user-authenticated OpenClaw browser gateway; browser-session safety requirements, failures, seat contract.
- `src/deepseek-webchat.ts`: DeepSeek WebChat browser-based seat with session isolation check, send/read, answer stabilization, cancellation, timeout, login failure and per-conversation locking. **Selectors are CANDIDATES and MUST be verified live**. No paid API endpoints.
- `src/model-menu.ts`: additive, idempotent WebChat model-menu group with **ChatGPT (WebChat)**, **DeepSeek (WebChat)**, **WebChat Council**, while retaining existing models/API labels.
- `src/council.ts`: independent parallel 2+ member WebChat council runs, attributable outputs, per-member error/timeout, explicit-opt-in synthesizer, partial failure reports, no paid fallback.
- `tests/core.test.mjs`: local mocked tests, no logins or web calls.

## Required integration by local/free implementation agent

1. **Read-only DSH source audit FIRST**: determine actual deployed versions on vmixer2o2/ndi2; review PM `T-46fceb2b` (ChatGPT OpenClaw GUI live proof, 2026-10-18) and `T-b6457931` (old layer-2 handoff). Locate installed `llm-openclaw-chatgpt` source, OpenClaw gateway, DSH provider registry, DSH model selector and existing DSH council engine. Watch for divergence/dirty worktrees.
2. Adapt `OpenClawBrowserBridge.openAuthorizedPage` to the actual reusable OpenClaw ChatGPT browser transport. **Never start a new unrelated browser gateway.** Scope session/profile to an authenticated DSH user, respect browser owner permissions, preserve the same tab for each DSH conversation, isolate fresh conversations and do not log session cookies.
3. Validate DeepSeek DOM selectors with a real account-holder-approved login in a controlled browser. If DeepSeek UI changes or a required selector is missing, surface a safe error; do not scrape private API requests, bypass CAPTCHA/limits, or invent output. Browser profile login must be done by its owner.
4. Register the DeepSeek seat ID `openclaw-deepseek/deepseek-web` and council ID `webchat-council/council` ONLY after checking ID conventions and extending real DSH contracts. Retain existing `openclaw-chatgpt/chatgpt-web` and current default; keep DeepSeek API provider separate.
5. Merge WebChat menu entries into actual DSH picker schema; the provided `ModelMenuItem` is a portability shim, not a claim about deployed DSH UI types.
6. Bind `runWebChatCouncil` into the **existing DSH council** rather than deploying a second scheduler. Use DSH's genuine permission gates, roster controls, storage, source evidence and PM run IDs. Add optional review rounds and future browser adapter registry as native DSH extension; starter code supplies parallel independent answers and explicit synthesis, **not complete production council GUI or peer-review orchestration**.
7. Respect DSH RBAC and coding-task approval; pass the actor's verified identity and conversation ID from DSH, not client-controlled prompts. Separate WebChat and API seats; no silent paid fallback and **no promise of unlimited WebChat usage**.
8. Tests: run `npm test`, then native DSH unit/integration suite, then controlled real browser GUI smoke tests for both seats, two-seat council, session history, restart, rollback and existing ChatGPT regression. Store exact build/hash and test evidence in PM. Do not mark as deployed merely because mock tests pass.

## Local verification

```bash
npm test
```

This is **working portable TypeScript code with mock tests**, not a finished patch to the unknown private DSH worktree. Local/free agents must map actual interfaces and verify live selectors before merging. No code has been pushed, installed, or deployed.
```

## `package.json`

```json
{
  "name": "dsh-webchat-council-starter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "npm run build && node --test tests/*.test.mjs" },
  "devDependencies": { "typescript": "^5.8.3" }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "declaration": true,
    "lib": ["ES2022", "DOM"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

## `src/contracts.ts`

```ts
/** Minimal interfaces to bind against the EXISTING DSH/OpenClaw browser gateway. */
export type SeatId = 'openclaw-chatgpt/chatgpt-web' | 'openclaw-deepseek/deepseek-web' | (string & {});

export type SeatContext = Readonly<{
  userId: string; // identity verified by DSH, never taken from untrusted prompt text
  conversationId: string; // DSH session/thread ID
  signal?: AbortSignal;
}>;

export type SeatReply = Readonly<{
  seatId: SeatId;
  content: string;
  source: 'webchat';
  durationMs: number;
}>;

export interface WebChatSeat {
  readonly id: SeatId;
  readonly label: string;
  generate(prompt: string, context: SeatContext): Promise<SeatReply>;
}

/** Existing OpenClaw browser transport must implement these minimal operations. */
export interface BrowserElement {
  isVisible(): Promise<boolean>;
  fill(text: string): Promise<void>; // editable text area / contenteditable
  click(): Promise<void>;
  innerText(): Promise<string>;
}
export interface BrowserPage {
  query(css: string): Promise<readonly BrowserElement[]>;
}
export interface OpenClawBrowserBridge {
  /**
   * Return an AUTHORIZED user-owned browser tab. Each (userId,conversationId,provider)
   * must be isolated from other conversations, while repeated calls for the same tuple
   * must return that conversation's tab. Do NOT silently create/login accounts.
   * The browser gateway navigates to url using the official webpage UI.
   */
  openAuthorizedPage(args: Readonly<{
    userId: string;
    conversationId: string;
    provider: 'deepseek-webchat';
    url: 'https://chat.deepseek.com';
    signal?: AbortSignal;
  }>): Promise<BrowserPage>;
}

export type WebChatFailureCode =
  | 'LOGIN_REQUIRED' | 'SELECTOR_UNVERIFIED' | 'CONVERSATION_NOT_ISOLATED'
  | 'BUSY' | 'TIMEOUT' | 'ABORTED' | 'EMPTY_REPLY';
export class WebChatFailure extends Error {
  constructor(public readonly code: WebChatFailureCode, message: string) {
    super(message);
    this.name = 'WebChatFailure';
  }
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WebChatFailure('ABORTED', 'WebChat request cancelled');
}
```

## `src/deepseek-webchat.ts`

```ts
import {
  type BrowserElement, type BrowserPage, type OpenClawBrowserBridge,
  type SeatContext, type SeatReply, type WebChatSeat, WebChatFailure, checkAbort,
} from './contracts.js';

/**
 * CANDIDATE selectors, NOT live-verified against current DeepSeek web UI.
 * The local implementing agent MUST validate/update these with an authorized account.
 * Never use undocumented private network endpoints or bypass login/CAPTCHA.
 */
export type DeepSeekSelectors = Readonly<{
  composer: readonly string[];
  send: readonly string[];
  assistantMessages: readonly string[];
  newChat: readonly string[];
  generating: readonly string[];
}>;
export const DEEPSEEK_CANDIDATE_SELECTORS: DeepSeekSelectors = {
  composer: ['textarea', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]'],
  send: ['button[aria-label="Send"]', 'button[data-testid="send-button"]'],
  assistantMessages: ['[data-role="assistant"]', '[data-message-role="assistant"]'],
  newChat: ['button[aria-label="New chat"]', '[data-testid="new-chat"]'],
  generating: ['button[aria-label="Stop generating"]', '[data-testid="stop-generating"]'],
};

export type DeepSeekOptions = Readonly<{
  selectors?: DeepSeekSelectors;
  pollMs?: number;
  timeoutMs?: number;
  stablePolls?: number;
}>;

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  checkAbort(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new WebChatFailure('ABORTED', 'Cancelled')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
};

async function firstVisible(page: BrowserPage, selectors: readonly string[]): Promise<BrowserElement | undefined> {
  for (const css of selectors) {
    for (const el of await page.query(css)) if (await el.isVisible()) return el;
  }
  return undefined;
}

async function visibleTexts(page: BrowserPage, selectors: readonly string[]): Promise<string[]> {
  for (const css of selectors) {
    const items: string[] = [];
    for (const el of await page.query(css)) if (await el.isVisible()) items.push((await el.innerText()).trim());
    if (items.length) return items;
  }
  return [];
}

/**
 * Browser-only DeepSeek seat: does NOT call a DeepSeek API, use an API key, or
 * bypass any provider limit. Existing OpenClaw gateway owns auth and browser.
 */
export class DeepSeekWebChatSeat implements WebChatSeat {
  readonly id = 'openclaw-deepseek/deepseek-web' as const;
  readonly label = 'DeepSeek (WebChat)';
  private readonly started = new Set<string>();
  private readonly active = new Set<string>();
  private readonly selectors: DeepSeekSelectors;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly stablePolls: number;

  constructor(private readonly bridge: OpenClawBrowserBridge, options: DeepSeekOptions = {}) {
    this.selectors = options.selectors ?? DEEPSEEK_CANDIDATE_SELECTORS;
    this.pollMs = options.pollMs ?? 750;
    this.timeoutMs = options.timeoutMs ?? 150_000;
    this.stablePolls = options.stablePolls ?? 3;
  }

  async generate(prompt: string, ctx: SeatContext): Promise<SeatReply> {
    if (!prompt.trim()) throw new Error('Prompt must not be empty');
    checkAbort(ctx.signal);
    const key = `${ctx.userId}\u0000${ctx.conversationId}`;
    if (this.active.has(key)) throw new WebChatFailure('BUSY', 'Conversation already has an active request');
    this.active.add(key);
    const start = Date.now();
    try {
      const page = await this.bridge.openAuthorizedPage({
        provider: 'deepseek-webchat', url: 'https://chat.deepseek.com',
        userId: ctx.userId, conversationId: ctx.conversationId, signal: ctx.signal,
      });
      checkAbort(ctx.signal);
      const composer = await firstVisible(page, this.selectors.composer);
      if (!composer) throw new WebChatFailure('LOGIN_REQUIRED', 'Please sign in to DeepSeek in the authorized browser session, or inspect page state');
      const before = await visibleTexts(page, this.selectors.assistantMessages);
      if (!this.started.has(key)) {
        const newChat = await firstVisible(page, this.selectors.newChat);
        if (newChat) await newChat.click();
        else if (before.length) throw new WebChatFailure('CONVERSATION_NOT_ISOLATED', 'Fresh DSH conversation must start in a new DeepSeek chat');
        this.started.add(key);
      }
      const baseline = (await visibleTexts(page, this.selectors.assistantMessages)).length;
      await composer.fill(prompt);
      const send = await firstVisible(page, this.selectors.send);
      if (!send) throw new WebChatFailure('SELECTOR_UNVERIFIED', 'DeepSeek send control unavailable; verify current UI selectors');
      await send.click();

      const deadline = Date.now() + this.timeoutMs;
      let previous = '';
      let stable = 0;
      while (Date.now() < deadline) {
        checkAbort(ctx.signal);
        const messages = await visibleTexts(page, this.selectors.assistantMessages);
        const response = messages.length > baseline ? (messages.at(-1) ?? '') : '';
        const stillGenerating = !!(await firstVisible(page, this.selectors.generating));
        if (response && response === previous && !stillGenerating) stable++;
        else stable = 0;
        if (stable >= this.stablePolls) {
          return { seatId: this.id, content: response, source: 'webchat', durationMs: Date.now() - start };
        }
        previous = response;
        await sleep(this.pollMs, ctx.signal);
      }
      throw new WebChatFailure('TIMEOUT', 'DeepSeek browser reply did not reach a verified stable state');
    } finally {
      this.active.delete(key);
    }
  }
}
```

## `src/model-menu.ts`

```ts
import type { SeatId } from './contracts.js';

/** UI metadata only. Route IDs must be resolved by EXISTING DSH provider registry. */
export type ModelMenuItem = Readonly<{
  id: string;
  label: string;
  group: string;
  kind: 'webchat' | 'council' | 'api' | 'local';
  provider?: SeatId;
}>;

export const WEBCHAT_MENU: readonly ModelMenuItem[] = [
  {
    id: 'openclaw-chatgpt/chatgpt-web', label: 'ChatGPT (WebChat)',
    group: 'WebChat', kind: 'webchat', provider: 'openclaw-chatgpt/chatgpt-web',
  },
  {
    id: 'openclaw-deepseek/deepseek-web', label: 'DeepSeek (WebChat)',
    group: 'WebChat', kind: 'webchat', provider: 'openclaw-deepseek/deepseek-web',
  },
  {
    id: 'webchat-council/council', label: 'WebChat Council',
    group: 'WebChat', kind: 'council',
  },
];

/** Merge into existing picker without replacing its original models or default. */
export function withWebChatGroup(existing: readonly ModelMenuItem[]): ModelMenuItem[] {
  const output = [...existing];
  for (const entry of WEBCHAT_MENU) {
    const pos = output.findIndex(x => x.id === entry.id);
    if (pos >= 0) output[pos] = entry; else output.push(entry);
  }
  return output;
}
```

## `src/council.ts`

```ts
import { type SeatContext, type SeatId, type SeatReply, type WebChatSeat } from './contracts.js';

export type CouncilMemberResult =
  | { seatId: SeatId; status: 'ok'; reply: SeatReply }
  | { seatId: SeatId; status: 'failed'; reason: string };
export type CouncilRun = Readonly<{
  runId: string;
  status: 'completed' | 'partial' | 'failed';
  members: readonly CouncilMemberResult[];
  synthesis?: SeatReply;
  synthesisError?: string;
}>;
export type CouncilOptions = Readonly<{
  runId: string; // caller supplies an auditable unique run ID, e.g., DSH council run id
  userId: string; // verified DSH role/identity, not browser-selected arbitrary identity
  prompt: string;
  memberIds: readonly SeatId[];
  perMemberTimeoutMs?: number;
  signal?: AbortSignal;
  /** Opt-in: sending all member responses to synthesizer shares them with that web provider. */
  synthesis?: Readonly<{ seatId: SeatId; shareResponsesApproved: true }>;
}>;

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'Unknown error';
}
function validate(o: CouncilOptions, seats: ReadonlyMap<string, WebChatSeat>): void {
  if (!o.runId.trim() || !o.userId.trim() || !o.prompt.trim()) throw new Error('runId, verified userId and prompt required');
  if (o.memberIds.length < 2 || new Set(o.memberIds).size !== o.memberIds.length) {
    throw new Error('Council requires at least two distinct WebChat seats');
  }
  for (const id of [...o.memberIds, ...(o.synthesis ? [o.synthesis.seatId] : [])]) {
    if (!seats.has(id)) throw new Error(`Not an authorized registered WebChat seat: ${id}`);
  }
  if (o.synthesis && o.synthesis.shareResponsesApproved !== true) throw new Error('Explicit peer-response sharing consent required');
}

/** Abort a member on timeout/cancel. No retry, bypass, or paid-provider fallback. */
async function callWithTimeout(
  seat: WebChatSeat, prompt: string, ctx: SeatContext, timeoutMs: number,
): Promise<SeatReply> {
  const controller = new AbortController();
  const parent = ctx.signal;
  const forwardAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', forwardAbort, { once: true });
  if (parent?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new Error('Provider timeout')), timeoutMs);
  try {
    // If the adapter ignores abort, surface that as a timeout instead of waiting forever.
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) { reject(controller.signal.reason); return; }
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('Cancelled')), { once: true });
    });
    return await Promise.race([
      seat.generate(prompt, { ...ctx, signal: controller.signal }), aborted,
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Pure WebChat council runner. Embed via the existing DSH council scheduler,
 * not as a second council system. Members reply independently; synthesis only
 * occurs when the caller explicitly opts into sharing responses with that seat.
 */
export async function runWebChatCouncil(
  options: CouncilOptions, seats: ReadonlyMap<string, WebChatSeat>,
): Promise<CouncilRun> {
  validate(options, seats);
  const timeoutMs = options.perMemberTimeoutMs ?? 160_000;
  const members: CouncilMemberResult[] = await Promise.all(options.memberIds.map(async seatId => {
    try {
      const reply = await callWithTimeout(seats.get(seatId)!, options.prompt, {
        userId: options.userId,
        conversationId: `${options.runId}:member:${seatId}`,
        signal: options.signal,
      }, timeoutMs);
      return { seatId, status: 'ok', reply } as const;
    } catch (err) {
      return { seatId, status: 'failed', reason: errorText(err) } as const;
    }
  }));

  const successful = members.filter((m): m is Extract<CouncilMemberResult, { status: 'ok' }> => m.status === 'ok');
  const status: CouncilRun['status'] = successful.length === members.length ? 'completed' : successful.length ? 'partial' : 'failed';
  if (!options.synthesis || successful.length < 2) return { runId: options.runId, status, members };

  // Include explicit speaker attribution and make disagreement visible to the reviewer.
  const synthesisPrompt = [
    'Synthesize the following independent WebChat council replies. Clearly identify consensus,',
    'substantive disagreements, uncertainties, and sources. Do not claim you verified facts independently.',
    `Original user question:\n${options.prompt}`,
    ...successful.map(m => `Member ${m.seatId}:\n${m.reply.content}`),
  ].join('\n\n');
  try {
    const synthesis = await callWithTimeout(seats.get(options.synthesis.seatId)!, synthesisPrompt, {
      userId: options.userId, conversationId: `${options.runId}:synthesis`, signal: options.signal,
    }, timeoutMs);
    return { runId: options.runId, status, members, synthesis };
  } catch (err) {
    return { runId: options.runId, status, members, synthesisError: errorText(err) };
  }
}
```

## `src/index.ts`

```ts
export * from './contracts.js';
export * from './deepseek-webchat.js';
export * from './model-menu.js';
export * from './council.js';
```

## `tests/core.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeepSeekWebChatSeat, runWebChatCouncil, withWebChatGroup, WebChatFailure,
} from '../dist/index.js';

function makeSeat(id, fn) {
  return { id, label: id, generate: async (prompt, ctx) => ({
    seatId: id, content: await fn(prompt, ctx), source: 'webchat', durationMs: 1,
  }) };
}

test('one WebChat menu group contains ChatGPT, DeepSeek and Council without deleting other models', () => {
  const menu = withWebChatGroup([{ id: 'deepseek/deepseek-api', label: 'DeepSeek API', group: 'API', kind: 'api' }]);
  assert.equal(menu.length, 4);
  assert.deepEqual(menu.filter(x => x.group === 'WebChat').map(x => x.id), [
    'openclaw-chatgpt/chatgpt-web', 'openclaw-deepseek/deepseek-web', 'webchat-council/council',
  ]);
  assert.equal(withWebChatGroup(menu).length, 4);
  assert.equal(menu[0].kind, 'api');
});

test('two-seat council returns attributable independent answers', async () => {
  const seats = new Map([
    ['chatgpt', makeSeat('chatgpt', async (prompt, ctx) => `A:${prompt}:${ctx.conversationId}`)],
    ['deepseek', makeSeat('deepseek', async prompt => `B:${prompt}`)],
  ]);
  const result = await runWebChatCouncil({
    runId: 'r1', userId: 'owner', prompt: 'hello', memberIds: ['chatgpt', 'deepseek'],
  }, seats);
  assert.equal(result.status, 'completed');
  assert.equal(result.members.length, 2);
  assert.match(result.members[0].reply.content, /r1:member:chatgpt/);
  assert.equal(result.members[1].reply.content, 'B:hello');
  assert.equal(result.synthesis, undefined); // never auto-share peer answers
});

test('council records partial failure without switching to paid provider', async () => {
  const seats = new Map([
    ['good', makeSeat('good', async () => 'answer')],
    ['bad', makeSeat('bad', async () => { throw new Error('Login required'); })],
  ]);
  const result = await runWebChatCouncil({runId:'r2', userId:'u', prompt:'x', memberIds:['good','bad']}, seats);
  assert.equal(result.status, 'partial');
  assert.equal(result.members[1].status, 'failed');
  assert.match(result.members[1].reason, /Login required/);
});

test('explicit synthesis shares attributed answers only with approved seat', async () => {
  const seen = [];
  const seats = new Map([
    ['a', makeSeat('a', async prompt => { seen.push(['a', prompt]); return 'answer A'; })],
    ['b', makeSeat('b', async prompt => { seen.push(['b', prompt]); return 'answer B'; })],
  ]);
  const result = await runWebChatCouncil({
    runId:'r3', userId:'u', prompt:'topic', memberIds:['a','b'],
    synthesis: {seatId:'a', shareResponsesApproved:true},
  }, seats);
  assert.equal(result.synthesis?.content, 'answer A');
  assert.equal(seen.length, 3);
  assert.match(seen[2][1], /answer B/);
});

test('council rejects duplicate members and unauthorized unregistered seats', async () => {
  const seats = new Map([['a', makeSeat('a', async () => 'ok')]]);
  await assert.rejects(() => runWebChatCouncil({runId:'x',userId:'u',prompt:'p',memberIds:['a','a']}, seats));
  await assert.rejects(() => runWebChatCouncil({runId:'x',userId:'u',prompt:'p',memberIds:['a','unknown']}, seats));
});

test('DeepSeek browser adapter uses existing authorized OpenClaw tab with 2 turn context', async () => {
  let messages = [];
  let lastText = '';
  let openCalls = [];
  const E = (fn = {}) => ({ isVisible: async () => true, innerText: async () => '',
    fill: async value => { lastText = value; }, click: async () => {}, ...fn });
  const page = { query: async css => {
    if (css === '.composer') return [E()];
    if (css === '.send') return [E({ click: async () => { messages.push('reply:' + lastText); } })];
    if (css === '.assistant') return messages.map(x => E({innerText: async () => x}));
    return [];
  }};
  const bridge = { openAuthorizedPage: async args => { openCalls.push(args); return page; } };
  const seat = new DeepSeekWebChatSeat(bridge, {pollMs:2, stablePolls:1, timeoutMs:300,
    selectors: {composer:['.composer'],send:['.send'],assistantMessages:['.assistant'],newChat:['.new'],generating:['.busy']} });
  const one = await seat.generate('hello', {userId:'u',conversationId:'thread'});
  const two = await seat.generate('again', {userId:'u',conversationId:'thread'});
  assert.equal(one.content, 'reply:hello');
  assert.equal(two.content, 'reply:again');
  assert.equal(openCalls.length, 2);
  assert.ok(openCalls.every(x => x.url === 'https://chat.deepseek.com'));
  assert.ok(openCalls.every(x => x.userId === 'u'));
});

test('DeepSeek fails closed on missing login or unverified send selector', async () => {
  const bridge = {openAuthorizedPage: async () => ({query: async () => []})};
  const seat = new DeepSeekWebChatSeat(bridge, {timeoutMs:20});
  await assert.rejects(() => seat.generate('hi', {userId:'u',conversationId:'s'}), e => e instanceof WebChatFailure && e.code === 'LOGIN_REQUIRED');
});
```
