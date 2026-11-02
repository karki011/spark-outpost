import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RulesEditAction } from '@spark-outpost/contracts';
import { rulesTextHash } from '../../spark-rules/accepted.ts';
import { RulesFileError } from '../../spark-rules/rules-file.ts';
import { performRulesEdit } from './rules-edit-perform.ts';

let dir: string;
const COMPANY_TEXT = '{"permissions":{"deny":["Push"]}}\n';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-perform-'));
  vi.stubEnv('SPARK_RULES_FILE', join(dir, 'settings.json'));
  vi.stubEnv('SPARK_MANAGED_RULES_FILE', join(dir, 'managed-settings.json'));
  await writeFile(join(dir, 'managed-settings.json'), COMPANY_TEXT);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function action(rule: string, target: RulesEditAction['target']): RulesEditAction {
  return {
    action: 'rules_edit',
    target,
    add: [{ effect: 'allow', rule }],
    remove: [],
    fileHash: rulesTextHash({ kind: 'text', text: COMPANY_TEXT }),
    agent: 'Claude',
    modeName: 'Bypass permissions',
    provider: 'claude',
    agentMode: 'bypassPermissions',
    sessionRow: null,
  };
}

describe('performing a rules card', () => {
  it.each(['managed', 'user'] as const)(
    'checks the rule ids again before writing the %s file',
    async (target) => {
      await expect(performRulesEdit(action('Bash(rm -rf /)', target))).rejects.toThrow(
        RulesFileError,
      );
      expect(await readFile(join(dir, 'managed-settings.json'), 'utf8')).toBe(COMPANY_TEXT);
      await expect(readFile(join(dir, 'settings.json'), 'utf8')).rejects.toThrow();
    },
  );

  it('writes the company file when the rules are known and the file is unchanged', async () => {
    await performRulesEdit(action('Gh(release create)', 'managed'));
    const written = JSON.parse(await readFile(join(dir, 'managed-settings.json'), 'utf8'));
    expect(written.permissions.allow).toEqual(['Gh(release create)']);
  });
});
