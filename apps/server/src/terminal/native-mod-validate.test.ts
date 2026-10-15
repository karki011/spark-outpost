import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSparkMod } from './native-mod-script.ts';

const claudeCli = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!claudeCli)('the Spark mod against the installed Claude Code', () => {
  it('passes claude plugin validate, so Claude Code loads it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spark-mod-validate-'));
    try {
      const checked = spawnSync('claude', ['plugin', 'validate', await writeSparkMod(folder)], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(checked.stdout + checked.stderr).toContain('Validation passed');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
