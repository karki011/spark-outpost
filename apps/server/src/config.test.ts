import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { branchName } from './projects/worktrees.ts';

const DATABASE_URL = 'postgres://spark@127.0.0.1:5432/spark_outpost';

describe('channel settings', () => {
  it('defaults to the installed app names', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.KEYCHAIN_SERVICE).toBe('Spark Outpost');
    expect(branchName('abcdef1234', 'Fix login', config.BRANCH_PREFIX)).toBe(
      'spark/abcdef12/fix-login',
    );
  });

  it('takes the launcher channel names', () => {
    const config = loadConfig({
      DATABASE_URL,
      KEYCHAIN_SERVICE: 'Spark Outpost Dev',
      BRANCH_PREFIX: 'spark-dev',
    });
    expect(config.KEYCHAIN_SERVICE).toBe('Spark Outpost Dev');
    expect(branchName('abcdef1234', 'Fix login', config.BRANCH_PREFIX)).toBe(
      'spark-dev/abcdef12/fix-login',
    );
  });

  it('rejects a branch prefix git would misread', () => {
    expect(() => loadConfig({ DATABASE_URL, BRANCH_PREFIX: '../main' })).toThrow(/BRANCH_PREFIX/);
  });
});
