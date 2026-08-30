import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAllPacks } from '../src/rules.js';

afterEach(() => {
  delete process.env['AEGIS_RULEPACK_DIR'];
});

describe('rulepack resolution', () => {
  it('honors AEGIS_RULEPACK_DIR override', () => {
    // Point the override at the real shipped rulepacks via the workspace symlink.
    const real = join(
      process.cwd(),
      'node_modules',
      '@heybeaux',
      'lattice-aegis',
      'rulepacks',
    );
    if (!existsSync(real)) return; // environment without workspace symlink
    const dir = mkdtempSync(join(tmpdir(), 'aegis-rulepacks-'));
    mkdirSync(dir, { recursive: true });
    cpSync(real, dir, { recursive: true });
    process.env['AEGIS_RULEPACK_DIR'] = dir;
    try {
      expect(loadAllPacks().length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
