import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  BUILDER_PUBLISH_REASON,
  NO_RUN_RULES,
  RUN_REJECTED_REASON,
  decide,
  forcePushReason,
  ruleFor,
  type ApprovalRequest,
} from './decide.ts';
import {
  MIRROR_PUSH_REASON,
  PLAIN_FORCE_REASON,
  UNNAMED_FORCE_REASON,
  protectedForceReason,
} from './git-commands.ts';

const ROOT = '/work/app';
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];

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

const everything = (command: string) => ({
  allow: [ruleFor(run(command))!],
  reject: [],
});

describe('decide() asks before a lease force push to a working branch', () => {
  it.each([
    ['git push --force-with-lease origin spark/fix-dates', ['spark/fix-dates']],
    ['git push --force-with-lease=feature:abc123 origin feature', ['feature']],
    ['git push --force-with-lease --force-if-includes origin HEAD:feature', ['feature']],
    ['git push --force-with-lease origin refs/heads/feature', ['feature']],
    ['git add . && git -C sub push --force-with-lease origin feature', ['feature']],
  ])('%s', (command, branches) => {
    for (const mode of EVERY_MODE) {
      const options = { defaultBranch: 'trunk' };
      expect(decide(mode, run(command), everything(command), ['git'], options)).toEqual({
        verdict: 'ask',
        reason: forcePushReason(branches),
        forcePush: branches,
      });
    }
  });

  it('names the branch and the remote in the reason', () => {
    expect(forcePushReason(['feature'])).toBe('This rewrites history on feature on the remote');
  });

  it('still lets a rejection for the run win', () => {
    const command = 'git push --force-with-lease origin feature';
    const rules = { allow: [], reject: [ruleFor(run(command))!] };
    expect(decide('asks', run(command), rules, [])).toEqual({
      verdict: 'reject',
      reason: RUN_REJECTED_REASON,
    });
  });
});

describe('decide() refuses the force pushes it cannot approve', () => {
  it.each([
    ['git push --force origin feature', PLAIN_FORCE_REASON],
    ['git push -f origin feature', PLAIN_FORCE_REASON],
    ['git push -fu origin feature', PLAIN_FORCE_REASON],
    ['git push origin +feature', PLAIN_FORCE_REASON],
    ['git push --force-with-lease origin +feature', PLAIN_FORCE_REASON],
    ['git push --mirror backup', MIRROR_PUSH_REASON],
    ['git push --force-with-lease', UNNAMED_FORCE_REASON],
    ['git push --force-with-lease origin', UNNAMED_FORCE_REASON],
    ['git push --force-with-lease origin HEAD', UNNAMED_FORCE_REASON],
    ['git push --force-with-lease --all origin', UNNAMED_FORCE_REASON],
    ['git push --force-with-lease origin main', protectedForceReason('main')],
    ['git push --force-with-lease origin feature:master', protectedForceReason('master')],
    ['git push --force-with-lease origin trunk', protectedForceReason('trunk')],
  ])('%s', (command, reason) => {
    for (const mode of EVERY_MODE) {
      const options = { defaultBranch: 'trunk' };
      expect(decide(mode, run(command), everything(command), ['git'], options)).toEqual({
        verdict: 'reject',
        reason,
      });
    }
  });

  it('asks a solo Builder, but refuses a coordinated one and every other publish', () => {
    const lease = run('git push --force-with-lease origin spark/fix');
    expect(decide('full_access', lease, NO_RUN_RULES, [], { builder: true })).toMatchObject({
      verdict: 'ask',
      forcePush: ['spark/fix'],
    });
    const coordinated = { builder: true, piece: { coordinated: true, owned: null } };
    const refused = { verdict: 'reject', reason: BUILDER_PUBLISH_REASON };
    expect(decide('full_access', lease, NO_RUN_RULES, [], coordinated)).toEqual(refused);
    for (const command of [
      'git push origin spark/fix',
      'git push --force-with-lease origin spark/fix && gh pr create',
    ]) {
      expect(decide('full_access', run(command), NO_RUN_RULES, [], { builder: true })).toEqual(
        refused,
      );
    }
  });

  it('leaves a lease flag without a force alone', () => {
    expect(
      decide('full_access', run('git push --force-if-includes origin feature'), NO_RUN_RULES, []),
    ).toEqual({ verdict: 'allow', by: 'level' });
  });
});
