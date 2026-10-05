import { describe, expect, it } from 'vitest';
import type {
  SourceFreshnessPolicyAuthority,
  SourceFreshnessPolicyAuthorityRoster,
  ToolCall,
} from '../src/index.js';

describe('public source freshness evidence types', () => {
  it('exports RT-43 authority and RT-44 roster contracts from the package root', () => {
    const authority: SourceFreshnessPolicyAuthority = {
      authorityId: 'policy:east',
      authenticated: true,
      policyId: 'freshness:deploy',
      policyVersion: 5,
      sourceVersionNamespace: 'deploy-target:v2',
      maxAgeMs: 100,
    };
    const roster: SourceFreshnessPolicyAuthorityRoster = {
      rosterId: 'policy-authority-roster:deploy',
      rosterEpoch: 2,
      rosterDigest: `sha256:${'0'.repeat(64)}`,
      authenticated: true,
      memberIds: ['policy:east'],
    };
    const call: ToolCall = {
      tool: 'ActOnRememberedFact',
      sourceFreshness: {
        expectedPolicyAuthorityIds: ['policy:east'],
        policyAuthorities: [authority],
        policyAuthorityRoster: roster,
      },
    };
    expect(call.sourceFreshness?.policyAuthorities).toEqual([authority]);
    expect(call.sourceFreshness?.policyAuthorityRoster).toEqual(roster);
  });
});
