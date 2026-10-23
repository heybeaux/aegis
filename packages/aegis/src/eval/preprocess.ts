/**
 * Decode-then-rescan preprocessing for obfuscated shell commands.
 *
 * Detects encoding/obfuscation patterns in a shell command, attempts to decode
 * them, and returns the union of the original string plus any successfully
 * decoded variants. The evaluator then runs the full rule corpus against ALL
 * strings — if any string trips a rule, the evaluation reflects it.
 *
 * Supported patterns (Phase 1):
 *   - base64 piped to shell:  echo <b64> | base64 -d | sh/bash/zsh
 *   - base64 decode inline:   base64 -d <<< <b64>
 *   - hex-escaped payload:    \x72\x6d ... (hex-encoded chars)
 *
 * Design: extractDecodedVariants() is pure — no throws, no side effects. If
 * decoding fails (bad padding, non-UTF-8, etc.) the variant is silently dropped
 * and only the original string is returned.
 */

/** Regex: `echo <b64> | base64 -d | (bash|sh|zsh|...)` or `printf '<b64>' | ...` */
const BASE64_PIPE_TO_SHELL =
  /(?:echo\s+|printf\s+['"]?)([A-Za-z0-9+/=]+)['"]?\s*\|[^|]*base64\s+-d\s*\|/i;

/** Regex: `base64 -d <<< <b64>` or `base64 --decode <<< <b64>` */
const BASE64_HERESTRING = /base64\s+(?:-d|--decode)\s+<<<\s+([A-Za-z0-9+/=]+)/i;

/** Regex: `$( base64 -d <<< <b64> )` subshell variant */
const BASE64_SUBSHELL_DECODE =
  /\$\(\s*(?:echo\s+)?([A-Za-z0-9+/=]+)\s*\|\s*base64\s+-d\s*\)/i;

/** Hex-escape sequence: sequences of `\xHH` */
const HEX_ESCAPE_SEQ = /(?:\\x[0-9a-fA-F]{2}){4,}/g;

function tryBase64Decode(b64: string): string | null {
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    // Reject if it looks like binary noise (non-printable chars dominate)
    const printable = decoded.replace(/[\x00-\x08\x0e-\x1f\x7f-\x9f]/g, '');
    if (printable.length < decoded.length * 0.8) return null;
    return decoded.trim();
  } catch {
    return null;
  }
}

function tryHexDecode(hexSeq: string): string | null {
  try {
    const bytes = hexSeq.match(/\\x([0-9a-fA-F]{2})/g);
    if (!bytes) return null;
    const decoded = Buffer.from(bytes.map((b) => parseInt(b.slice(2), 16))).toString('utf8');
    return decoded.trim();
  } catch {
    return null;
  }
}

/**
 * Given a shell command string, return an array containing the original string
 * plus any successfully decoded variants. Always includes the original.
 *
 * Callers should run the rule corpus against every element in the result.
 */
export function extractDecodedVariants(command: string): string[] {
  return collectDecodedVariants(command).variants;
}

interface AdmissionLimits {
  commandUnits: number;
  variants: number;
  decodedUnits: number;
}

// Deterministic admission caps, not wall-clock or absolute resource guarantees.
const EVALUATOR_LIMITS: AdmissionLimits = { commandUnits: 65536, variants: 64, decodedUnits: 8192 };

/** Internal evaluator boundary. The public standalone extractor retains its legacy contract. */
export function admittedDecodedVariants(command: string): { variants: string[]; incomplete: boolean } {
  return collectDecodedVariants(command, EVALUATOR_LIMITS);
}

function collectDecodedVariants(command: string, limits?: AdmissionLimits): { variants: string[]; incomplete: boolean } {
  const variants: string[] = [command];
  const seen = new Set(variants);
  let decodedUnits = 0;
  if (limits && command.length > limits.commandUnits) return { variants, incomplete: true };

  // false signals the first exceeding UNIQUE candidate. Duplicates/noise do not
  // consume admission. No partial payload or later encoding can conceal omission.
  function admit(decoded: string | null): boolean {
    if (!decoded || seen.has(decoded)) return true;
    if (limits && (variants.length >= limits.variants || decodedUnits + decoded.length > limits.decodedUnits)) return false;
    seen.add(decoded);
    decodedUnits += decoded.length;
    variants.push(decoded);
    return true;
  }

  // Preserve family priority and existing first-only base64 recognition. Exp69's
  // pending occurrence-completeness change is a separate policy, not included here.
  for (const pattern of [BASE64_PIPE_TO_SHELL, BASE64_HERESTRING, BASE64_SUBSHELL_DECODE]) {
    const match = pattern.exec(command);
    if (match && !admit(tryBase64Decode(match[1]!))) return { variants, incomplete: true };
  }

  // Iterate lazily; command.match() would materialize all matches before admission.
  // A local RegExp keeps lastIndex isolated across calls and early returns.
  const hex = new RegExp(HEX_ESCAPE_SEQ.source, HEX_ESCAPE_SEQ.flags);
  let match: RegExpExecArray | null;
  while ((match = hex.exec(command)) !== null) {
    if (!admit(tryHexDecode(match[0]))) return { variants, incomplete: true };
  }
  return { variants, incomplete: false };
}
