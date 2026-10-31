import { appendFile, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

function line(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${name}`);
  return value.trim();
}

function git(repo, args) {
  const safeRepo = repo.replaceAll('\\', '/');
  const result = spawnSync('git', ['-c', `safe.directory=${safeRepo}`, '-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function resolveLocalRepo(repo, home = homedir()) {
  repo = line(repo, 'repo');
  if (!isAbsolute(repo)) throw new Error('Repository path must be absolute');
  const original = resolve(repo);
  if (existsSync(original)) return original;
  const match = original.match(/^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)([\\/].+)$/i);
  if (!match) throw new Error(`Repository path does not exist on this machine: ${original}`);
  const candidate = resolve(home, match[2].replace(/^[\\/]+/, ''));
  if (!existsSync(candidate) || !existsSync(join(candidate, '.git'))) {
    throw new Error(`Repository path does not exist on this machine: ${original}`);
  }
  return candidate;
}

/** Queue committed work for independent human review. Never build, commit, or push. */
export async function queueBuild({ repo, model, validation, target, queue = join(homedir(), '.claude', 'shared-brain', 'push-requests.md') }) {
  repo = resolveLocalRepo(repo);
  model = line(model, 'model');
  validation = line(validation, 'validation');
  const branch = git(repo, ['branch', '--show-current']);
  if (!branch) throw new Error('Detached HEAD cannot be queued');
  git(repo, ['check-ref-format', '--branch', branch]);
  if (git(repo, ['status', '--porcelain'])) throw new Error('Working tree must be clean before queue submission');
  const url = git(repo, ['remote', 'get-url', '--push', 'origin']);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url)) throw new Error('Expected an HTTPS GitHub origin');
  // A writer worktree sits on its own branch and asks for a fast-forward of target.
  let base = '@{upstream}';
  if (target !== undefined) {
    target = line(target, 'target');
    git(repo, ['check-ref-format', '--branch', target]);
    if (target === branch) throw new Error('Target must differ from the current branch; omit --target instead');
    base = `refs/remotes/origin/${target}`;
    try { git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); }
    catch { throw new Error(`Local tracking ref origin/${target} is missing; fetch it first`); }
  } else {
    const upstream = git(repo, ['rev-parse', '--abbrev-ref', '@{upstream}']);
    if (upstream !== `origin/${branch}`) throw new Error('Upstream must match the branch on origin');
  }
  const counts = git(repo, ['rev-list', '--left-right', '--count', `${base}...HEAD`]).split(/\s+/).map(Number);
  if (counts[0] !== 0 || counts[1] < 1) throw new Error('Expected locally recorded upstream to be behind HEAD, without divergence');
  const head = git(repo, ['rev-parse', 'HEAD']);
  const commits = git(repo, ['log', '--reverse', '--format=%s', `${base}..HEAD`]).split('\n');
  if (git(repo, ['rev-parse', 'HEAD']) !== head) throw new Error('HEAD changed while preparing the request');
  const destination = target ?? branch;
  const source = target === undefined ? '' : `Source-Branch: ${branch}\n`;
  const entry = `## ${repo} \u2014 ${destination}\nFiled: ${new Date().toISOString()} by ${model}\nStatus: open\nHost: ${hostname().toLowerCase()}\nHead: ${head}\n${source}Remote: origin ${url}\nCommits:\n${commits.map(s => `  ${s}`).join('\n')}\nNotes: ${validation}. Submitted for user review, not push authorization. Upstream comparison used local tracking refs; gatekeeper must verify the live destination.\n`;
  await mkdir(dirname(queue), { recursive: true });
  const lockPath = `${queue}.submission.lock`;
  // Cooperating producers serialize deduplication. Never reclaim another writer's lock.
  const lock = await open(lockPath, 'wx');
  try {
    const text = await readFile(queue, 'utf8');
    const marker = text.indexOf('<!-- REQUESTS BELOW THIS LINE.');
    if (marker < 0) throw new Error('Queue marker is missing');
    const entries = text.slice(marker).replace(/\r\n/g, '\n').split(/(?=^## )/m);
    // Each entry's template puts exactly one 'Filed:' line right after its own
    // '## ' heading; more than one means a prior request missing its own
    // heading is already merged into this entry \u2014 refuse to append into it.
    const corrupted = entries.find(e => (e.match(/^Filed: /gm) || []).length > 1);
    if (corrupted) throw new Error(`Corrupted queue entry: multiple 'Filed:' lines found, meaning a request missing its own '## ' heading is merged into it: ${corrupted.split('\n')[0]}`);
    const duplicate = entries.some(e => e.startsWith(`## ${repo} \u2014 ${destination}\n`) && /^Status: open\r?$/m.test(e) && e.includes(`Head: ${head}`));
    if (duplicate) return { queued: false, head, reason: 'already queued' };
    await appendFile(queue, `\n${entry}`, 'utf8');
    return { queued: true, head, queue };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--target');
  const target = flag < 0 ? undefined : args.splice(flag, 2)[1];
  const [repo, model, validation, queue] = args;
  try {
    if (flag >= 0 && !target) throw new Error('--target needs a branch name');
    console.log(JSON.stringify(await queueBuild({ repo, model, validation, ...(target ? { target } : {}), ...(queue ? { queue } : {}) })));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
