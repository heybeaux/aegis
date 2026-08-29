import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TelemetryEvent {
  ts: string;
  event:
    | 'hook.invalid_input'
    | 'hook.decision'
    | 'hook.shadow_decision'
    | 'predictor.fallback'
    | 'approval.requested'
    | 'approval.approved'
    | 'approval.consumed';
  adapter?: string;
  tool?: string;
  toolUseId?: string;
  action?: 'allow' | 'ask' | 'deny';
  reason?: string;
  approvalId?: string;
  predictor?: {
    source?: string;
    pFailure?: number;
    confidence?: number;
    latencyMs?: number;
    mode?: string;
    state?: string;
    actionKey?: string;
  };
  details?: Record<string, unknown>;
}

function telemetryPath(): string {
  const root = process.env['AEGIS_HOME'] ?? join(homedir(), '.aegis');
  return process.env['AEGIS_HOOK_TELEMETRY_PATH'] ?? join(root, 'hook-runtime.jsonl');
}

export function writeTelemetry(event: Omit<TelemetryEvent, 'ts'>): void {
  try {
    const path = telemetryPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
      }) + '\n',
      'utf8',
    );
  } catch {
    // Telemetry is strictly fail-open.
  }
}
