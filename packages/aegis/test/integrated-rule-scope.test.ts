import { expect, it } from 'vitest';
import { evaluate, loadPack } from '../src/index.js';
it('validates process-scoped caches before matching refined ProcessInput calls', () => {
  const rules = loadPack({packId:'integration',version:'1',rules:[{
    id:'critical-process',category:'bash',severity:'critical',description:'danger',
    appliesTo:['process'],match:{kind:'regex',pattern:'danger',target:'content'},
  }]});
  rules[0]!.regex = /benign/;
  const result = evaluate({tool:'ProcessInput',content:'benign'}, rules);
  expect(result.action).toBe('ask');
  expect(result.matches.map(hit=>hit.id)).toEqual(['swarmlab.rt52.compiled-rule-requires-bound-stateless-matcher']);
  expect(result.reason).toContain('compiled regex');
});
