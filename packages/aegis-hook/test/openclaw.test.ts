import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenClawAdapter, openClawToolCall } from '../src/openclaw.js';
import { runHook } from '../src/runtime.js';

afterEach(() => {
  delete process.env['AEGIS_HOME'];
  delete process.env['AEGIS_COLLECT_DIR'];
  delete process.env['AEGIS_SHADOW_MODE'];
});

describe('OpenClaw adapter', () => {
  it('maps native OpenClaw tool envelopes to Aegis calls', () => {
    expect(
      openClawToolCall({
        toolName: 'exec',
        toolCallId: 'call-1',
        params: { command: 'git push --force origin main', workdir: '/tmp/repo' },
      }),
    ).toEqual({
      tool: 'Bash',
      command: 'git push --force origin main',
      paths: ['/tmp/repo'],
    });

    expect(
      openClawToolCall({
        toolName: 'edit',
        params: { path: '/tmp/a.txt', newText: 'hello' },
        derivedPaths: ['/tmp/a.txt'],
      }),
    ).toEqual({ tool: 'Edit', content: 'hello', paths: ['/tmp/a.txt'] });

    expect(
      openClawToolCall({
        toolName: 'task',
        params: {
          fact_lifecycle: {
            fact_class: 'deployment_target',
            usage_kind: 'deploy',
            basis_status: 'supported',
            latest_status: 'supported',
            superseded: true,
            replacement_available: true,
            recovery_observed: false,
          },
        },
      }),
    ).toEqual({
      tool: 'Delegate',
      factLifecycle: {
        factClass: 'deployment_target',
        usageKind: 'deploy',
        basisStatus: 'supported',
        latestStatus: 'supported',
        superseded: true,
        replacementAvailable: true,
        recoveryObserved: false,
      },
    });

    expect(
      openClawToolCall({
        toolName: 'task',
        params: {
          verification: {
            high_risk_audit: true,
            verification_tier: 'retrieval_grounded',
            verification_status: 'supported',
            panel_diversity: 'cross_provider',
            criterion_pinned: false,
            shared_premise_risk: true,
            source_diversity: 'single_source',
            adversarial_verifier_present: false,
            specialist_verifier_present: false,
            task_class: 'fact_check',
          },
        },
      }),
    ).toEqual({
      tool: 'Delegate',
      verification: {
        highRiskAudit: true,
        status: 'supported',
        tier: 'retrieval_grounded',
        panelDiversity: 'cross_provider',
        criterionPinned: false,
        sharedPremiseRisk: true,
        sourceDiversity: 'single_source',
        adversarialVerifierPresent: false,
        specialistVerifierPresent: false,
        taskClass: 'fact_check',
      },
    });

    expect(
      openClawToolCall({
        toolName: 'task',
        params: {
          coordination: {
            operation: 'merge',
            branch_freshness: 'stale',
            overlap_class: 'api_drift',
            merge_queue_present: true,
            semantic_review_present: false,
            verification_coverage: 'visible',
          },
        },
      }),
    ).toEqual({
      tool: 'Delegate',
      coordination: {
        operation: 'merge',
        branchFreshness: 'stale',
        overlapClass: 'api_drift',
        mergeQueuePresent: true,
        semanticReviewPresent: false,
        verificationCoverage: 'visible',
      },
    });
  });

  it('evaluates in fail-open shadow mode and records an exact decision join key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aegis-openclaw-'));
    process.env['AEGIS_HOME'] = home;
    process.env['AEGIS_COLLECT_DIR'] = home;
    try {
      const response = await runHook(
        createOpenClawAdapter({
          toolName: 'exec',
          toolCallId: 'oc-call-1',
          params: { command: 'git push --force origin main' },
        }),
        '',
        { shadow: true, provenance: {
          source: 'openclaw',
          agentId: 'nori',
          sessionKey: 'agent:nori:main',
          runId: 'run-1',
          provider: 'sakana',
          model: 'fugu',
          resolvedRef: 'sakana/fugu',
        } },
      );
      expect(response.exitCode).toBe(0);
      const observation = JSON.parse(response.stdout) as Record<string, unknown>;
      expect(observation).toMatchObject({ action: 'ask', decidedBy: 'severity' });

      const decision = JSON.parse(readFileSync(join(home, 'decisions.jsonl'), 'utf8')) as {
        toolUseId?: string;
        model?: string;
        provider?: string;
        agentId?: string;
        runId?: string;
        resolvedRef?: string;
        shadow?: { enabled?: boolean; action?: string };
      };
      expect(decision).toMatchObject({
        toolUseId: 'oc-call-1',
        model: 'fugu',
        provider: 'sakana',
        agentId: 'nori',
        runId: 'run-1',
        resolvedRef: 'sakana/fugu',
      });
      expect(decision.shadow).toMatchObject({ enabled: true, action: 'ask' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
