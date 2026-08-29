import { evaluate } from '@heybeaux/lattice-aegis';
import type { HostAdapter, HookResponse } from './adapters.js';
import { loadAllPacks } from './rules.js';
import { decide } from './decide.js';
import { recordDecisionSafely } from './collect.js';
import {
  observeDecision,
  predictWithPolicy,
  predictorFailureModeFromEnv,
} from './predictor.js';
import { writeTelemetry } from './telemetry.js';

export async function runHook(adapter: HostAdapter, input: string): Promise<HookResponse> {
  const request = adapter.parse(input);
  if (!request.valid || request.call === undefined) {
    writeTelemetry({
      event: 'hook.invalid_input',
      adapter: adapter.name,
      reason: request.invalidReason ?? 'invalid hook payload',
    });
    return adapter.renderInvalid(request.invalidReason ?? 'invalid hook payload');
  }

  const failureMode = predictorFailureModeFromEnv();
  const predictor = await predictWithPolicy(request.call, failureMode);
  if (predictor.mode === 'fallback') {
    writeTelemetry({
      event: 'predictor.fallback',
      adapter: adapter.name,
      tool: request.call.tool,
      toolUseId: request.toolUseId,
      reason: predictor.fallbackReason,
      predictor: {
        source: predictor.prediction.source,
        pFailure: predictor.prediction.pFailure,
        confidence: predictor.prediction.confidence,
        latencyMs: predictor.latencyMs,
        mode: failureMode,
        state: predictor.state,
        actionKey: predictor.actionKey,
      },
    });
  }

  const evaluation = evaluate(request.call, loadAllPacks(), {
    preprocess: true,
    prediction: predictor.prediction,
  });

  await recordDecisionSafely(request.call, evaluation, request.toolUseId);

  const reasonPrefix =
    predictor.mode === 'fallback'
      ? failureMode === 'fail-closed'
        ? 'Predictor unavailable in fail-closed mode.'
        : failureMode === 'degraded'
          ? 'Predictor unavailable in degraded mode.'
          : undefined
      : undefined;
  const decision = decide(evaluation, {
    call: request.call,
    reasonOverride:
      reasonPrefix === undefined || evaluation.decidedBy !== 'prediction'
        ? undefined
        : `${reasonPrefix} ${predictor.fallbackReason ?? 'Unknown predictor failure.'}`,
    approvalActionKey: predictor.actionKey,
  });

  observeDecision(predictor.actionKey, evaluation.action, predictor.prediction);

  writeTelemetry({
    event: 'hook.decision',
    adapter: adapter.name,
    tool: request.call.tool,
    toolUseId: request.toolUseId,
    action: evaluation.action,
    reason: decision.stderr || evaluation.reason,
    approvalId: decision.approval?.id,
    predictor: {
      source: predictor.prediction.source,
      pFailure: predictor.prediction.pFailure,
      confidence: predictor.prediction.confidence,
      latencyMs: predictor.latencyMs,
      mode: predictor.mode === 'fallback' ? failureMode : 'live',
      state: predictor.state,
      actionKey: predictor.actionKey,
    },
    details: {
      decidedBy: evaluation.decidedBy,
      degraded: predictor.degraded,
      matches: evaluation.matches.map((match) => match.id),
    },
  });

  if (decision.approval?.event === 'requested') {
    writeTelemetry({
      event: 'approval.requested',
      adapter: adapter.name,
      tool: request.call.tool,
      toolUseId: request.toolUseId,
      action: evaluation.action,
      approvalId: decision.approval.id,
      reason: evaluation.reason,
      predictor: {
        actionKey: predictor.actionKey,
      },
    });
  }
  if (decision.approval?.event === 'consumed') {
    writeTelemetry({
      event: 'approval.consumed',
      adapter: adapter.name,
      tool: request.call.tool,
      toolUseId: request.toolUseId,
      action: evaluation.action,
      approvalId: decision.approval.id,
      reason: evaluation.reason,
      predictor: {
        actionKey: predictor.actionKey,
      },
    });
  }

  return adapter.render({ decision, evaluation, request, predictor });
}
