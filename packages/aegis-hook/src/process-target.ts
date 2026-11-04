import type { ToolCall } from '@heybeaux/lattice-aegis';

/** Validate and detach only the host-owned identity fields. This is an adapter
 * contract, not cryptographic verification; tool arguments are never authority. */
export function processTarget(value: unknown): ToolCall['processTarget'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { hostId, sessionId, generationId, verified } = value as Record<string, unknown>;
  if (verified !== true || typeof hostId !== 'string' || hostId.trim().length === 0 ||
      typeof sessionId !== 'string' || sessionId.trim().length === 0 ||
      typeof generationId !== 'string' || generationId.trim().length === 0) return undefined;
  return { hostId, sessionId, generationId, verified: true };
}

export function processTargetFor(call: ToolCall): ToolCall['processTarget'] {
  return call.tool === 'ProcessInput' ? processTarget(call.processTarget) : undefined;
}
