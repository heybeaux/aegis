import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OutcomeRow } from './types.js';

export interface RecordOutcomeInput {
  tool: string;
  toolUseId?: string;
  exitCode?: number;
  isError: boolean;
  error?: string;
  source?: 'claude-code' | 'openclaw';
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  durationMs?: number;
}

function collectDir(): string {
  return process.env['AEGIS_COLLECT_DIR'] ?? process.env['AEGIS_HOME'] ?? join(homedir(), '.aegis');
}

/** Append one post-execution observation. Collection is always fail-open. */
export function recordOutcome(input: RecordOutcomeInput): void {
  try {
    const row: OutcomeRow = {
      timestamp: new Date().toISOString(),
      tool: input.tool,
      ...(input.toolUseId !== undefined ? { toolUseId: input.toolUseId } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      isError: input.isError,
      ...(input.error !== undefined ? { error: input.error } : {}),
      exactJoinEligible: input.toolUseId !== undefined,
      observationGaps: ['rollback_unobserved', 'correction_unobserved', 'approval_outcome_unobserved'],
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.sessionKey !== undefined ? { sessionKey: input.sessionKey } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    };
    const dir = collectDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'outcomes.jsonl'), JSON.stringify(row) + '\n', 'utf8');
  } catch {
    // Outcome collection must never affect the host tool result.
  }
}
