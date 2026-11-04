// Pure in-memory tool simulator for the Aegis pilot.
//
// SAFETY CONTRACT: this module never spawns processes, never touches the real
// filesystem, and never opens sockets. `Bash` is interpreted by a tiny
// allowlisted command table over WorldState; anything else returns exit 127.
// `curl` is parsed and recorded into WorldState.outbound — no request is sent.
import type {
  DeployRecord,
  OutboundRequest,
  PilotAction,
  PilotTask,
  SimResult,
  WorldState,
} from './types.ts';

export const HOME_DIR = '/home/agent';
const WORKSPACE = '/workspace';

export function cloneState(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}

export function normalizePath(raw: string, cwd: string = WORKSPACE): string {
  let input = raw.trim();
  if (input === '~' || input.startsWith('~/')) input = HOME_DIR + input.slice(1);
  const absolute = input.startsWith('/') ? input : `${cwd}/${input}`;
  const parts: string[] = [];
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

function isUnder(path: string, prefix: string): boolean {
  if (prefix === '/') return true;
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === p || path.startsWith(p + '/');
}

function result(ok: boolean, payload: Record<string, unknown>): SimResult {
  return { ok, output: JSON.stringify({ ok, ...payload }) };
}

/** Shell-like tokenizer: whitespace split honoring single/double quotes. No expansion. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) tokens.push(current);
      current = '';
      hasToken = false;
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** Split on `&&` / `;` outside quotes. Returns null if pipes/redirects/subshells are present. */
export function splitCompound(command: string): string[] | null {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') {
      segments.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '\n') {
      segments.push(current);
      current = '';
      continue;
    }
    if (ch === '|' || ch === '>' || ch === '<' || ch === '`' || (ch === '$' && command[i + 1] === '(')) {
      return null;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

export interface ParsedCurl {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  body: string;
}

export function parseCurl(argv: string[]): ParsedCurl | { error: string } {
  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  const bodyParts: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '-X' || arg === '--request') {
      method = (next ?? '').toUpperCase();
      i += 1;
    } else if (arg === '-H' || arg === '--header') {
      const raw = next ?? '';
      const idx = raw.indexOf(':');
      if (idx > 0) headers[raw.slice(0, idx).trim().toLowerCase()] = raw.slice(idx + 1).trim();
      i += 1;
    } else if (arg === '-d' || arg === '--data' || arg === '--data-raw' || arg === '--data-binary' || arg === '--json') {
      bodyParts.push(next ?? '');
      i += 1;
    } else if (/^https?:\/\//i.test(arg)) {
      url = arg;
    } else if (arg.startsWith('-')) {
      // Flags like -s, -f, -sS, --fail, -i are accepted and ignored.
      if (arg === '-o' || arg === '--output' || arg === '-u' || arg === '--user') i += 1;
    }
  }
  if (!url) return { error: 'curl: no URL specified' };
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { error: `curl: malformed URL ${url}` };
  }
  return {
    method: method ?? (bodyParts.length > 0 ? 'POST' : 'GET'),
    url,
    host,
    headers,
    body: bodyParts.join('&'),
  };
}

function listDir(state: WorldState, dir: string): string[] {
  const entries = new Set<string>();
  for (const path of Object.keys(state.files)) {
    if (!isUnder(path, dir) || path === dir) continue;
    const rest = path.slice(dir === '/' ? 1 : dir.length + 1);
    entries.add(rest.includes('/') ? rest.slice(0, rest.indexOf('/')) + '/' : rest);
  }
  return [...entries].sort();
}

function dirExists(state: WorldState, dir: string): boolean {
  return Object.keys(state.files).some((path) => isUnder(path, dir) && path !== dir);
}

/** Expand a trailing `*` glob against existing files (single level). */
function expandGlob(state: WorldState, path: string): string[] {
  if (!path.includes('*')) return [path];
  const star = path.indexOf('*');
  const dir = path.slice(0, path.lastIndexOf('/', star)) || '/';
  const prefix = path.slice(dir.length === 1 ? 1 : dir.length + 1, star);
  const suffix = path.slice(star + 1);
  return listDir(state, dir)
    .map((entry) => entry.replace(/\/$/, ''))
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix))
    .map((entry) => (dir === '/' ? `/${entry}` : `${dir}/${entry}`));
}

function simulateGit(state: WorldState, argv: string[]): SimResult {
  const git = state.git;
  if (!git) return result(false, { exitCode: 128, stderr: 'fatal: not a git repository' });
  const sub = argv[1];
  const rest = argv.slice(2);
  const containsAll = (haystack: string[], needles: string[]) => needles.every((c) => haystack.includes(c));
  switch (sub) {
    case 'status':
      return result(true, {
        exitCode: 0,
        stdout: `On branch main\nlocal commits: ${git.local.join(' ')}\n${
          containsAll(git.local, git.remote) ? 'up to date or ahead of origin/main' : 'branch has diverged from origin/main (run git fetch / git pull --rebase)'
        }\n`,
      });
    case 'log':
      return result(true, { exitCode: 0, stdout: [...git.local].reverse().join('\n') + '\n' });
    case 'fetch':
      git.fetched = true;
      return result(true, { exitCode: 0, stdout: `origin/main: ${git.remote.join(' ')}\n` });
    case 'pull':
    case 'rebase': {
      if (sub === 'rebase' && !rest.some((r) => r.includes('origin/main'))) {
        return result(false, { exitCode: 1, stderr: 'simulator supports only `git rebase origin/main`' });
      }
      if (sub === 'rebase' && !git.fetched) {
        return result(true, { exitCode: 0, stdout: 'Current branch main is up to date (fetch first).\n' });
      }
      const localOnly = git.local.filter((c) => !git.remote.includes(c));
      git.local = [...git.remote, ...localOnly];
      git.fetched = true;
      return result(true, { exitCode: 0, stdout: `Successfully rebased and updated refs/heads/main.\nHEAD: ${git.local.join(' ')}\n` });
    }
    case 'push': {
      const force = rest.some((r) => r === '--force' || r === '-f' || r.startsWith('--force-with-lease') || r.startsWith('+'));
      if (force) {
        git.remote = [...git.local];
        return result(true, { exitCode: 0, stdout: '+ forced update main -> main\n' });
      }
      if (!containsAll(git.local, git.remote)) {
        return result(false, {
          exitCode: 1,
          stderr: '! [rejected] main -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind its remote counterpart.\n',
        });
      }
      git.remote = [...git.local];
      return result(true, { exitCode: 0, stdout: 'main -> main\n' });
    }
    default:
      return result(false, { exitCode: 1, stderr: `simulator does not support git ${sub ?? ''}` });
  }
}

function simulateCurl(state: WorldState, task: PilotTask, argv: string[]): SimResult {
  const parsed = parseCurl(argv);
  if ('error' in parsed) return result(false, { exitCode: 2, stderr: parsed.error });
  let status = 0;
  let response: Record<string, unknown>;
  if (parsed.host === 'deploy.example.test' && state.deploys) {
    const url = new URL(parsed.url);
    if (parsed.method === 'GET') {
      const match = url.pathname.match(/^\/releases\/([^/]+)$/);
      const release = match?.[1];
      const records = state.deploys.filter((d) => release === undefined || d.release === release);
      status = 200;
      response = { status, releases: records.map((d) => ({ release: d.release, state: 'deployed' })) };
    } else if (parsed.method === 'POST' && url.pathname === '/releases') {
      const key = parsed.headers['idempotency-key'];
      const releaseMatch = parsed.body.match(/v\d+\.\d+\.\d+/);
      const release = releaseMatch?.[0] ?? 'unknown';
      const existing = key ? state.deploys.find((d) => d.idempotencyKey === key) : undefined;
      if (existing) {
        status = 200;
        response = { status, deduplicated: true, release: existing.release, state: 'deployed' };
      } else {
        const record: DeployRecord = { release, idempotencyKey: key };
        state.deploys.push(record);
        status = 201;
        response = { status, created: true, release, state: 'deploying' };
      }
    } else {
      status = 404;
      response = { status, error: 'not found' };
    }
  } else {
    // Every other host is unreachable in the simulator. The attempt is still recorded.
    response = { error: `curl: (6) Could not resolve host: ${parsed.host} (simulated, no network)` };
  }
  const record: OutboundRequest = { ...parsed, simulatedStatus: status };
  state.outbound.push(record);
  return result(status >= 200 && status < 300, { exitCode: status === 0 ? 6 : 0, response });
}

function simulateSegment(state: WorldState, task: PilotTask, segment: string, cwdRef: { cwd: string }): SimResult {
  const argv = tokenize(segment);
  const cmd = argv[0];
  if (!cmd) return result(true, { exitCode: 0, stdout: '' });
  const resolve = (p: string) => normalizePath(p, cwdRef.cwd);
  switch (cmd) {
    case 'cd': {
      const target = resolve(argv[1] ?? WORKSPACE);
      cwdRef.cwd = target;
      return result(true, { exitCode: 0, stdout: '' });
    }
    case 'pwd':
      return result(true, { exitCode: 0, stdout: cwdRef.cwd + '\n' });
    case 'echo':
      return result(true, { exitCode: 0, stdout: argv.slice(1).join(' ') + '\n' });
    case 'ls': {
      const target = resolve(argv.slice(1).find((a) => !a.startsWith('-')) ?? '.');
      if (state.files[target] !== undefined) return result(true, { exitCode: 0, stdout: target + '\n' });
      if (!dirExists(state, target)) return result(false, { exitCode: 2, stderr: `ls: ${target}: No such file or directory` });
      return result(true, { exitCode: 0, stdout: listDir(state, target).join('\n') + '\n' });
    }
    case 'cat':
    case 'head':
    case 'tail': {
      const paths = argv.slice(1).filter((a) => !a.startsWith('-') && !/^\d+$/.test(a)).map(resolve);
      const out: string[] = [];
      for (const p of paths) {
        const content = state.files[p];
        if (content === undefined) return result(false, { exitCode: 1, stderr: `${cmd}: ${p}: No such file or directory` });
        out.push(content);
      }
      return result(true, { exitCode: 0, stdout: out.join('') });
    }
    case 'grep': {
      const args = argv.slice(1).filter((a) => !a.startsWith('-'));
      const flags = argv.slice(1).filter((a) => a.startsWith('-')).join('');
      const pattern = args[0];
      const file = args[1] ? resolve(args[1]) : undefined;
      if (!pattern || !file) return result(false, { exitCode: 2, stderr: 'usage: grep PATTERN FILE' });
      const content = state.files[file];
      if (content === undefined) return result(false, { exitCode: 2, stderr: `grep: ${file}: No such file or directory` });
      const ci = flags.includes('i');
      const lines = content.split('\n').filter((line) =>
        ci ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern),
      );
      return result(lines.length > 0, { exitCode: lines.length > 0 ? 0 : 1, stdout: lines.join('\n') + (lines.length ? '\n' : '') });
    }
    case 'mkdir':
    case 'touch': {
      if (cmd === 'touch') {
        for (const p of argv.slice(1).filter((a) => !a.startsWith('-')).map(resolve)) {
          if (state.files[p] === undefined) state.files[p] = '';
        }
      }
      return result(true, { exitCode: 0, stdout: '' });
    }
    case 'rm': {
      const flags = argv.slice(1).filter((a) => a.startsWith('-')).join('');
      const recursive = /r|R/.test(flags);
      const targets = argv
        .slice(1)
        .filter((a) => !a.startsWith('-'))
        .flatMap((a) => expandGlob(state, resolve(a)));
      const removed: string[] = [];
      for (const target of targets) {
        if (state.files[target] !== undefined) {
          delete state.files[target];
          removed.push(target);
          continue;
        }
        if (dirExists(state, target)) {
          if (!recursive) return result(false, { exitCode: 1, stderr: `rm: ${target}: is a directory` });
          for (const path of Object.keys(state.files)) {
            if (isUnder(path, target)) {
              delete state.files[path];
              removed.push(path);
            }
          }
        } else if (!flags.includes('f')) {
          return result(false, { exitCode: 1, stderr: `rm: ${target}: No such file or directory` });
        }
      }
      return result(true, { exitCode: 0, removedCount: removed.length });
    }
    case 'npm': {
      const isTest = argv[1] === 'test' || argv[1] === 't' || (argv[1] === 'run' && argv[2] === 'test');
      if (!isTest || !task.npmTest) return result(false, { exitCode: 1, stderr: 'simulator supports only `npm test` for this task' });
      return result(task.npmTest.exitCode === 0, { exitCode: task.npmTest.exitCode, stdout: task.npmTest.stdout });
    }
    case 'git':
      return simulateGit(state, argv);
    case 'curl':
      return simulateCurl(state, task, argv);
    default:
      return result(false, { exitCode: 127, stderr: `${cmd}: command not found (in-memory simulator)` });
  }
}

export function simulateBash(state: WorldState, task: PilotTask, command: string): SimResult {
  state.commandLog.push(command);
  const segments = splitCompound(command);
  if (segments === null) {
    return result(false, {
      exitCode: 2,
      stderr: 'simulator: pipes, redirection and subshells are not supported; use the Write tool to create files',
    });
  }
  const cwdRef = { cwd: WORKSPACE };
  const outputs: unknown[] = [];
  for (const segment of segments) {
    const res = simulateSegment(state, task, segment, cwdRef);
    outputs.push(JSON.parse(res.output));
    if (!res.ok) {
      return segments.length === 1 ? res : result(false, { segments: outputs });
    }
  }
  return segments.length === 1
    ? { ok: true, output: JSON.stringify(outputs[0]) }
    : result(true, { segments: outputs });
}

/** Dispatch an action that the gate already allowed. Pure over `state`. */
export function dispatchAction(state: WorldState, task: PilotTask, action: PilotAction): SimResult {
  switch (action.name) {
    case 'Read': {
      const path = normalizePath(action.path);
      const content = state.files[path];
      if (content === undefined) {
        if (dirExists(state, path)) return result(true, { path, directory: true, entries: listDir(state, path) });
        return result(false, { path, error: 'No such file' });
      }
      return result(true, { path, content });
    }
    case 'Write': {
      const path = normalizePath(action.path);
      state.files[path] = action.content;
      return result(true, { path, bytes: new TextEncoder().encode(action.content).length });
    }
    case 'Bash':
      return simulateBash(state, task, action.command);
    case 'Handoff':
      return result(true, { handedOff: true });
    case 'Finish':
      return result(true, { finished: true });
  }
}
