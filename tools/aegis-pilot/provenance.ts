// Provenance helpers: repo SHA (read straight from .git, no git subprocess),
// canonical config hashing and pilot source hashing.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** JSON with sorted object keys so hashes are independent of insertion order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

function resolveGitDir(repoRoot: string): string | undefined {
  const dotGit = join(repoRoot, '.git');
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return dotGit;
  const pointer = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m)?.[1];
  if (!pointer) return undefined;
  return isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
}

function readRef(gitDir: string, commonDir: string, ref: string): string | undefined {
  for (const dir of [gitDir, commonDir]) {
    const loose = join(dir, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
  }
  const packed = join(commonDir, 'packed-refs');
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      const [sha, name] = line.trim().split(' ');
      if (name === ref && sha) return sha;
    }
  }
  return undefined;
}

export interface RepoProvenance {
  headSha: string | 'unknown';
  headRef: string | 'detached' | 'unknown';
  /** Working-tree cleanliness cannot be determined without running git; recorded as unknown. */
  dirty: 'unknown';
}

export function readRepoProvenance(repoRoot: string): RepoProvenance {
  const gitDir = resolveGitDir(repoRoot);
  if (!gitDir) return { headSha: 'unknown', headRef: 'unknown', dirty: 'unknown' };
  const commonPointer = join(gitDir, 'commondir');
  const commonDir = existsSync(commonPointer)
    ? resolve(gitDir, readFileSync(commonPointer, 'utf8').trim())
    : gitDir;
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
  if (/^[0-9a-f]{40}$/.test(head)) return { headSha: head, headRef: 'detached', dirty: 'unknown' };
  const ref = head.match(/^ref:\s*(.+)$/)?.[1];
  if (!ref) return { headSha: 'unknown', headRef: 'unknown', dirty: 'unknown' };
  return { headSha: readRef(gitDir, commonDir, ref) ?? 'unknown', headRef: ref, dirty: 'unknown' };
}

/** Hash of every pilot source file (this directory + the CLI entry), so fixtures/oracles are pinned. */
export function hashPilotSources(repoRoot: string): { sha256: string; files: Record<string, string> } {
  const pilotDir = join(repoRoot, 'tools/aegis-pilot');
  const files = [
    ...readdirSync(pilotDir)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .map((f) => join(pilotDir, f)),
    join(repoRoot, 'tools/aegis-pilot-runner.ts'),
  ].filter((f) => existsSync(f));
  const perFile: Record<string, string> = {};
  const hash = createHash('sha256');
  for (const file of files) {
    const rel = file.slice(repoRoot.length + 1);
    const content = readFileSync(file);
    perFile[rel] = sha256(content);
    hash.update(rel + '\0' + perFile[rel] + '\0');
  }
  return { sha256: hash.digest('hex'), files: perFile };
}
