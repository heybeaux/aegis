import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluate, type ToolCall } from '@heybeaux/lattice-aegis';
import { openClawToolCall } from '../src/openclaw.js';
import { actionKeyFor } from '../src/predictor.js';
import { approvalPaths, approvalSignature, requestApproval, approvePending, consumeApproval } from '../src/approval.js';
import { decide } from '../src/decide.js';
const dirs: string[] = [];
const directory = () => { const d = mkdtempSync(join(tmpdir(), 'aegis-generation-test-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const target = () => ({ hostId: 'host', sessionId: 'session', generationId: 'generation', verified: true });
const event = () => ({ toolName: 'process', params: { action: 'write', sessionId: 'session', data: 'safe' }, processTarget: target() });
const grant = (call: ToolCall, dir: string) => { const e = evaluate(call, []); const pending = requestApproval(call, e, dir); approvePending(pending.id, dir); return { e, pending }; };
describe('authenticated process target approval consumption', () => {
  it.each(['generationId', 'hostId'] as const)('rejects changed %s without consuming the original grant', field => {
    const e = event(), call = openClawToolCall(e), dir = directory(), { e: evaluation, pending } = grant(call, dir);
    e.processTarget[field] += '-new'; const retry = openClawToolCall(e);
    expect(approvalSignature(retry, evaluation)).not.toBe(approvalSignature(call, evaluation));
    expect(actionKeyFor(retry)).not.toBe(actionKeyFor(call));
    expect(consumeApproval(retry, evaluation, dir)).toBe(false);
    expect(existsSync(approvalPaths(pending.id, dir).approvedPath)).toBe(true);
    expect(consumeApproval(call, evaluation, dir)).toBe(true);
    expect(consumeApproval(call, evaluation, dir)).toBe(false);
  });
  it('accepts equivalent host evidence and detaches producer references', () => {
    const e = event(), call = openClawToolCall(e), dir = directory(), { e: evaluation } = grant(call, dir);
    const retry = openClawToolCall({ ...event(), processTarget: { verified: true, generationId: 'generation', sessionId: 'session', hostId: 'host' } });
    e.processTarget.generationId = 'mutated';
    expect(approvalSignature(call, evaluation)).toBe(approvalSignature(retry, evaluation));
    expect(actionKeyFor(call)).toBe(actionKeyFor(retry));
    expect(consumeApproval(retry, evaluation, dir)).toBe(true);
  });
  it.each([undefined, null, {}, [], { ...target(), verified: false }, { ...target(), verified: 'true' }, { ...target(), generationId: '' }, { ...target(), hostId: '   ' }, { ...target(), sessionId: 'other' }])('cannot approve unavailable or malformed host evidence %j', evidence => {
    // Model an untyped host integration: the public boundary must fail closed.
    const e = { ...event(), processTarget: evidence } as unknown as Parameters<typeof openClawToolCall>[0];
    const call = openClawToolCall(e), dir = directory(), { e: evaluation } = grant(call, dir);
    expect(consumeApproval(call, evaluation, dir)).toBe(false);
    const decision = decide(evaluation, { call, approvalDir: dir });
    expect(decision.exitCode).toBe(2);
    expect(decision.stderr).toContain('authenticated process target');
  });
  it('never promotes tool params to host authority', () => {
    const call = openClawToolCall({ toolName: 'process', params: { ...event().params, processTarget: target(), verified: true } });
    const dir = directory(), { e } = grant(call, dir);
    expect(consumeApproval(call, e, dir)).toBe(false);
  });
  it('enforces target validity on direct ToolCall consumption too', () => {
    const projected = openClawToolCall(event());
    const call = { ...projected, processTarget: { ...target(), verified: false } } as ToolCall;
    const dir = directory(), { e } = grant(call, dir);
    expect(consumeApproval(call, e, dir)).toBe(false);
  });
  it('does not bind unrelated host metadata to legacy approvals', () => {
    const a = openClawToolCall({ toolName: 'exec', params: { command: 'pwd' }, processTarget: target() });
    const b = openClawToolCall({ toolName: 'exec', params: { command: 'pwd' }, processTarget: { ...target(), generationId: 'new' } });
    expect(approvalSignature(a, evaluate(a, []))).toBe(approvalSignature(b, evaluate(b, [])));
    expect(actionKeyFor(a)).toBe(actionKeyFor(b));
  });
});
