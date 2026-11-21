/**
 * Combinator-aware safe-command allowlist. Ported from AutoHarness `_is_safe_command`
 * (core/risk.py) — the one piece of their engine logic worth taking verbatim.
 *
 * Refuses to fast-path ("safe") anything containing shell combinators, because a
 * combinator can smuggle a dangerous command past a naive allowlist. Uses word-boundary
 * matching so `catastrophe` is not treated as `cat`.
 */

/** Shell metacharacters/combinators that disqualify a command from the fast path. */
const COMBINATORS = ['\n', ';', '&&', '||', '|', '$(', '`', '>', '<', '&'];

/** Package-owned implicit allowlist; explicit allowlist arguments select host policy. */
const IMPLICIT_SAFE = new Set([
  'ls',
  'cat',
  'echo',
  'pwd',
  'whoami',
  'date',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'which',
  'git',
]);

function hasCombinator(command: string): boolean {
  return COMBINATORS.some((c) => command.includes(c));
}

/**
 * True only if the command's leading token is allowlisted AND it contains no shell
 * combinators. Anything with a combinator is never fast-pathed.
 * Embedded LF is a shell command separator, including after a comment. Reject it
 * conservatively even inside quotes or continuations; this is not a shell parser.
 * Leading/trailing whitespace is still ignored before checking the command.
 */
export function isSafeCommand(
  command: string,
  allowlist: ReadonlySet<string> = IMPLICIT_SAFE,
): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  if (hasCombinator(trimmed)) return false;

  // Leading token, word-boundary aware (so `catastrophe` != `cat`).
  const match = /^(\S+)/.exec(trimmed);
  if (!match) return false;
  const head = match[1];

  return allowlist.has(head);
}

/** Editable recipe. Set mutations affect only calls explicitly supplied this template. */
export const DEFAULT_SAFE = new Set(IMPLICIT_SAFE);
