import { describe, expect, it } from 'vitest';
import { checkFailureText, mainAgentPublishNote, namedFiles, pullBaseLine } from './context.ts';

describe('context assembly', () => {
  it("names the pull request base only for a chat built on another chat's branch", () => {
    expect(mainAgentPublishNote('spark/web-5e')).not.toContain('--base');
    const stacked = mainAgentPublishNote('spark/web-5e', 'spark/api-1a');
    expect(stacked).toContain(pullBaseLine('spark/api-1a'));
    expect(stacked).toContain('`gh pr create --base spark/api-1a`');
    expect(stacked).toContain('Leave the base of a pull request that already exists as it is');
    expect(stacked).toMatch(/Never force-push/);
  });

  it('asks for the push alone when the user asked for the push and no pull request', () => {
    const note = mainAgentPublishNote('spark/web-5e', 'spark/api-1a', true);
    expect(note).toContain('`git push origin spark/web-5e`');
    expect(note).toContain('Do not open a pull request');
    expect(note).not.toContain('gh pr create');
    expect(note).not.toContain('spark_pull_request');
    expect(note).toMatch(/Never force-push/);
  });

  it('shows the end of each failing check’s output', () => {
    const failures = checkFailureText([
      { command: 'npm test', outcome: 'failed', exitCode: 1, outputTail: `${'x'.repeat(5000)}END` },
      { command: 'npm run lint', outcome: 'failed', exitCode: 2, outputTail: '' },
    ]);
    expect(failures).toContain('`npm test` exited 1:');
    expect(failures).toContain('END');
    expect(failures).toContain('`npm run lint` exited 2:\n```text\n(no output)\n```');
    expect(failures.length).toBeLessThan(3_200);
  });

  it('finds the files a plan names', () => {
    expect(namedFiles(['Edit `src/a.ts` and README.md', 'no files here'])).toEqual([
      'src/a.ts',
      'README.md',
    ]);
    expect(namedFiles(['Move it into src/b.ts. Then update src/c.ts.'])).toEqual([
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});
