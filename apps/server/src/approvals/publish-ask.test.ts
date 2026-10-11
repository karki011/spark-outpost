import { describe, expect, it } from 'vitest';
import { CHAT_PUBLISH_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import {
  publishAsk,
  publishBasis,
  publishRequested,
  publishVerdict,
  requestedBy,
  type PublishGrant,
} from './publish-policy.ts';

const PUSH_ONLY = { push: true, pull: false };
const BOTH = { push: true, pull: true };
const NOTHING = { push: false, pull: false };

describe('publishAsk() reads a push and a pull request separately', () => {
  it.each([
    ['push it', PUSH_ONLY],
    ['push', PUSH_ONLY],
    ['git push it to origin', PUSH_ONLY],
    ['Push this branch, but do not open a pull request', PUSH_ONLY],
    ['Push this branch, but do not open a pull request.', PUSH_ONLY],
    ["push the branch but don't open a PR", PUSH_ONLY],
    ['Do not open a PR, just push the branch', PUSH_ONLY],
    ["Don't create a pull request. Push the changes.", PUSH_ONLY],
    ['push it without opening a PR', PUSH_ONLY],
    ['never open a PR for this\npush the branch', PUSH_ONLY],
    ['push the branch; no need to open a pull request', PUSH_ONLY],
    ['open a PR', BOTH],
    ['Open a pull request for this', BOTH],
    ['push the branch and raise a PR', BOTH],
    ["open a PR, don't merge", BOTH],
    ['Fix the parser, push it and open a draft pull request', BOTH],
    ["don't push yet, but open a draft PR", BOTH],
    ['dont use spark to open pr', BOTH],
    ["don't push", NOTHING],
    ["don't push yet", NOTHING],
    ['do not open a PR', NOTHING],
    ['never push to main', NOTHING],
    ["don't push or open a PR", NOTHING],
    ["don't push the branch and don't open a PR", NOTHING],
    ['fix the tests without pushing or opening anything', NOTHING],
    ['add push notifications to the settings page', NOTHING],
    ['what happened to the PR?', NOTHING],
  ])('%s', (text, asked) => {
    expect(publishAsk(text)).toEqual(asked);
    expect(publishRequested(text)).toBe(asked.push);
  });
});

describe('publishAsk() keeps the limits it had', () => {
  it('still counts a push the message only quotes', () => {
    expect(publishAsk('Rename the button to "push it"')).toEqual(PUSH_ONLY);
  });

  it('still counts a push whose "do not" is words away from it', () => {
    expect(publishAsk('do not under any circumstances push this')).toEqual(PUSH_ONLY);
  });
});

const BRANCH = 'spark/fix-dates-1a2b';
const ROOT = '/work/app/.spark/worktrees/chat-1';
const TASK = { branch: BRANCH, protectedBranches: ['main', 'master'] };
const PUSH = `git push -u origin ${BRANCH}`;
const PR = 'gh pr create --title "Fix dates" --body "Parses ISO dates"';

function grantFor(text: string, level: PublishGrant['level'] = 'hands-off'): PublishGrant {
  return { level, ...requestedBy(text) };
}

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

describe('"Push this branch, but do not open a pull request" in a mode that asks', () => {
  const grant = grantFor('Push this branch, but do not open a pull request');
  const options = { changesProject: true, publish: { grant, task: TASK } };

  it.each(['asks', 'edits'] as const)("allows the push of the chat's own branch in %s", (mode) => {
    expect(publishVerdict(PUSH, mode, { grant, task: TASK })).toEqual({
      kind: 'allow',
      basis: 'requested',
    });
    expect(decide(mode, run(PUSH), NO_RUN_RULES, [], options)).toMatchObject({ verdict: 'allow' });
  });

  it.each(['asks', 'edits'] as const)('refuses the pull request in %s', (mode) => {
    expect(publishVerdict(PR, mode, { grant, task: TASK })).toBeNull();
    expect(decide(mode, run(PR), NO_RUN_RULES, [], options)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
    expect(decide(mode, run(`${PUSH} && ${PR}`), NO_RUN_RULES, [], options)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
  });

  it('still lets the agent look at the pull request', () => {
    expect(publishBasis('edits', grant)).toBe('requested');
    expect(decide('edits', run('gh pr view'), NO_RUN_RULES, [], options)).toMatchObject({
      verdict: 'allow',
    });
  });

  it('does not take away what the mode or Full auto → PR already allow', () => {
    expect(publishVerdict(PR, 'auto', { grant, task: TASK })).toEqual({
      kind: 'allow',
      basis: 'mode',
    });
    const fullAuto = { ...grant, level: 'full-auto' as const };
    expect(publishVerdict(PR, 'edits', { grant: fullAuto, task: TASK })).toEqual({
      kind: 'allow',
      basis: 'full_auto',
    });
  });
});

describe('a message that asks for a pull request', () => {
  it('allows the push the pull request needs, and the pull request', () => {
    const grant = grantFor('open a PR');
    for (const command of [PUSH, PR, `${PUSH} && ${PR}`]) {
      expect(publishVerdict(command, 'edits', { grant, task: TASK })).toEqual({
        kind: 'allow',
        basis: 'requested',
      });
    }
  });

  it('allows neither when it declines both', () => {
    const grant = grantFor("don't push or open a PR");
    expect(publishVerdict(PUSH, 'edits', { grant, task: TASK })).toBeNull();
    expect(publishVerdict(PR, 'edits', { grant, task: TASK })).toBeNull();
  });

  it('reads a grant that names no action as asking for both, as before', () => {
    const grant: PublishGrant = { level: 'hands-off', requested: true };
    expect(publishVerdict(PR, 'edits', { grant, task: TASK })).toMatchObject({ kind: 'allow' });
  });
});
