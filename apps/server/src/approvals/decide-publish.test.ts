import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  BUILDER_PUBLISH_REASON,
  NO_RUN_RULES,
  PUBLISH_ASKED_WHY,
  PUBLISH_FULL_AUTO_WHY,
  PUSH_REASON,
  decide,
  forcePushReason,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import { REMOTE_RAIL_REASON, otherBranchReason, type PublishGrant } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const MANUAL: PublishGrant = { level: 'balanced', requested: false };
const ASKED: PublishGrant = { level: 'balanced', requested: true };
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

  it('still asks after the run read sensitive data', () => {
    const decision = decideAs('full_access', PUSH, options(MANUAL, { observed: ['.env'] }));
    expect(decision).toMatchObject({ verdict: 'ask', observed: ['.env'] });
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
