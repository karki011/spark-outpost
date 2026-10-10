import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parentNotPushedReason } from '../src/approvals/publish-policy.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { watchedSends } from '../src/observations/send-watch.ts';
import { listRailFlags } from '../src/persistence/rail-flags.ts';
import type { ProtocolObserver } from '../src/providers/provider.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { commandRequest, recordingAppend, sendDo } from './approval-support.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { ownedWorktree, stackedPair, type StackedPair } from './stack-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const API = 'spark/orders-endpoint-1a2b3c4d';
const WEB = 'spark/orders-page-5e6f7a8b';
const PUSH = `git push -u origin ${WEB}`;
const TITLE = `Fake provider pushed a branch whose parent branch is not on the remote: ${WEB} on @api's ${API}`;

let t: TestDb;
let scratch: string;
let repo: TestRepo;
let pair: StackedPair;
let webPath: string;
let runId: string;

beforeEach(async () => {
  t = await createTestDb();
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-stacked-push-')));
  repo = await repoWithRemote(scratch, 'shop');
  pair = await stackedPair(t, repo.root);
  git(repo.root, 'branch', API);
  git(repo.root, 'branch', WEB, API);
  webPath = join(scratch, 'web-copy');
  const place = { projectId: pair.projectId, root: repo.root };
  await ownedWorktree(t, { ...place, conversationId: pair.api }, API, 'main');
  await ownedWorktree(t, { ...place, conversationId: pair.web, path: webPath }, WEB, API);
  runId = await sendDo(t, pair.web, 'build the page', 'hands-off');
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

function watch() {
  const audited: { method?: string; params?: { rail?: string } }[] = [];
  const audit: ProtocolObserver = {
    message: (_direction, message) => audited.push(message as (typeof audited)[number]),
    stderr: () => undefined,
  };
  const observations = createRunObservations({ db: t.db, runId, audit });
  const observer = watchedSends(audit, {
    db: t.db,
    runId,
    mode: 'do',
    projectRoots: [webPath],
    observations,
  });
  const update = (fields: Record<string, unknown>) =>
    observer.message('from_agent', { method: 'session/update', params: { update: fields } });
  const command = (toolCallId: string, text: string) => {
    const tool = { kind: 'execute', title: text, rawInput: { command: text } };
    update({ sessionUpdate: 'tool_call', toolCallId, status: 'pending', ...tool });
    update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
  };
  const asked = (toolCallId: string) =>
    observer.message('from_agent', {
      id: 7,
      method: 'session/request_permission',
      params: { toolCall: { toolCallId } },
    });
  const flags = async () => {
    await observations.settled();
    return listRailFlags(t.db, pair.web);
  };
  const crossings = () => audited.filter((entry) => entry.method === 'spark/rail_crossed');
  return { command, asked, flags, crossings };
}

describe('a raw git push of a stacked branch that ran without a permission request', () => {
  it('is flagged once, without a revert, and recorded in the audit while the parent is not on the remote', async () => {
    const seen = watch();
    seen.command('p1', PUSH);
    seen.command('p2', PUSH);

    const flags = await seen.flags();
    expect(flags).toMatchObject([
      { rail: 'stacked_push', title: TITLE, inside: false, status: 'open', runId },
    ]);
    expect(seen.crossings()).toMatchObject([{ params: { rail: 'stacked_push' } }]);
  });

  it('is flagged for a push that names no branch', async () => {
    const seen = watch();
    seen.command('p1', 'git push');
    expect((await seen.flags()).map((flag) => flag.rail)).toEqual(['stacked_push']);
  });

  it('is not flagged once the parent branch is on the remote', async () => {
    git(repo.root, 'push', '-q', 'origin', API);
    const seen = watch();
    seen.command('p1', PUSH);
    expect(await seen.flags()).toEqual([]);
  });

  it('is not flagged for a push the gate was asked about or another command', async () => {
    const seen = watch();
    seen.asked('gated');
    seen.command('gated', PUSH);
    seen.command('status', `git status && git log origin/${WEB}`);
    expect(await seen.flags()).toEqual([]);
  });

  it('leaves a push of another branch to the other branch flag', async () => {
    const seen = watch();
    seen.command('other', `git push origin ${API}`);
    expect((await seen.flags()).map((flag) => flag.rail)).toEqual(['other_push']);
  });
});

describe('the same push in a mode that asks', () => {
  function gate(builder: boolean, requested: boolean) {
    return createApprovalGate({
      db: t.db,
      runId,
      provider: 'claude',
      mode: 'default',
      builder,
      append: recordingAppend().append,
      waiters: new ApprovalWaiters(),
      pollMs: 20,
      onTimeout: () => undefined,
      backup: async () => undefined,
      publish: { level: 'hands-off', requested },
    });
  }

  it.each([
    ['the chat’s own agent when the message asked', false, true],
    ['the chat’s own agent with no request, before any card', false, false],
    ['a Builder when the message asked', true, true],
  ])('is refused for %s, with the reason spark_push gives', async (_name, builder, requested) => {
    const answer = await gate(builder, requested).review(
      commandRequest(webPath, PUSH),
      new AbortController().signal,
    );

    expect(answer).toMatchObject({ outcome: 'selected', allowed: false });
    const { rows } = await t.db.query<{ status: string; decided_by: string; reason: string }>(
      'SELECT status, decided_by, reason FROM approvals WHERE run_id = $1',
      [runId],
    );
    expect(rows).toEqual([
      {
        status: 'denied',
        decided_by: 'policy',
        reason: parentNotPushedReason(WEB, { branch: API, owner: '@api' }),
      },
    ]);
  });
});
