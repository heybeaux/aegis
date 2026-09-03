import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/eval/evaluate.js';

describe('evaluate — SwarmLab RT-16 workflow-resume gates', () => {
  it('asks when a risky partial-success resume targets a completed step', () => {
    const result = evaluate(
      {
        tool: 'Bash',
        command: 'npm publish',
        workflowResume: {
          operation: 'resume_workflow_step',
          workflowState: 'partial_success',
          stepStatus: 'completed',
          approvalBinding: 'task',
          bindingMatch: false,
          remainingStepVerified: false,
          riskLevel: 'high',
        },
      },
      [],
    );
    expect(result.action).toBe('ask');
    expect(result.matches.map((m) => m.id)).toContain(
      'swarmlab.rt16.partial-success-resumes-require-step-integrity',
    );
    expect(result.reason).toContain('SwarmLab RT-16');
  });

  it('asks when a risky partial-success resume uses the right command family on the wrong instance', () => {
    const result = evaluate(
      {
        tool: 'Bash',
        command: 'deploy-canary --env canary',
        workflowResume: {
          operation: 'resume_workflow_step',
          workflowState: 'partial_success',
          stepStatus: 'remaining',
          approvalBinding: 'step',
          bindingMatch: false,
          remainingStepVerified: true,
          riskLevel: 'high',
        },
      },
      [],
    );
    expect(result.action).toBe('ask');
    expect(result.matches.map((m) => m.id)).toContain(
      'swarmlab.rt16.partial-success-resumes-require-step-integrity',
    );
  });

  it('allows a verified exact step-instance resume', () => {
    const result = evaluate(
      {
        tool: 'Bash',
        command: 'deploy-canary --env canary',
        workflowResume: {
          operation: 'resume_workflow_step',
          workflowState: 'partial_success',
          stepStatus: 'remaining',
          approvalBinding: 'step_instance',
          bindingMatch: true,
          remainingStepVerified: true,
          riskLevel: 'high',
        },
      },
      [],
    );
    expect(result.action).toBe('allow');
    expect(result.matches).toHaveLength(0);
  });
});
