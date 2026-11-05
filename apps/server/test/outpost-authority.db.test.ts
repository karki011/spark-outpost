import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { actionFacts, actionPath } from '../src/spark-mcp/actions/action-policy.ts';
import { publishGrant, startBasis } from '../src/workflow/publish-context.ts';
import { publishReason } from '../src/workflow/publish-step-reason.ts';
import { drainQueue, type ResolveTarget } from '../src/workflow/queue-drain.ts';
import { loadRunInput, type RunInput } from '../src/workflow/run-input.ts';
import { addMemberChat, createOutpostRow, deliverRequest, postRunId } from './outpost-fixtures.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let outpostId: string;
let api: string;

const target: ResolveTarget = async () => ({ provider: 'claude' });
const OPEN_A_PR = 'Add the endpoint and open a PR.';
const POST_TO_SLACK = 'Post the result to the #orders Slack channel.';

beforeEach(async () => {
  t = await createTestDb();
  outpostId = await createOutpostRow(t);
  api = await addMemberChat(t, outpostId, 'api');
});

afterEach(async () => {
  await t.cleanup();
});

interface Chat {
  level: 'full-auto' | 'hands-off';
  agentMode: string;
}

async function withSettings(runId: string, chat: Chat): Promise<RunInput> {
  await t.db.query(`UPDATE runs SET mode = 'do', level = $2, agent_mode = $3 WHERE id = $1`, [
    runId,
    chat.level,
    chat.agentMode,
  ]);
  return loadRunInput(t.db, runId);
}

async function requestTurn(body: string, fromUser: boolean, chat: Chat) {
  const postId = await deliverRequest(t.db, {
    outpostId,
    toConversationId: api,
    toHandle: 'api',
    body,
    fromUser,
  });
  await drainQueue(t.db, api, target);
  const runId = (await postRunId(t.db, postId))!;
  return { postId, runId, input: await withSettings(runId, chat) };
}

async function typedTurn(content: string, chat: Chat) {
  const sent = await sendUserMessage(
    t.db,
    api,
    { id: randomUUID(), content, source: 'ui' },
    { provider: 'claude' },
  );
  return { runId: sent.run.id, input: await withSettings(sent.run.id, chat) };
}

const publishAsked = (input: RunInput) => publishReason(input) === 'asked';

const FULL_AUTO: Chat = { level: 'full-auto', agentMode: 'acceptEdits' };
const ACCEPT_EDITS: Chat = { level: 'hands-off', agentMode: 'acceptEdits' };
const BYPASS: Chat = { level: 'hands-off', agentMode: 'bypassPermissions' };

describe('"open a PR" written by another chat', () => {
  it('publishes on the Full auto → PR basis and never as requested', async () => {
    const { input } = await requestTurn(OPEN_A_PR, false, FULL_AUTO);

    expect(publishGrant(input)).toMatchObject({ requested: false, level: 'full-auto' });
    expect(startBasis(input)).toBe('full_auto');
    expect(publishAsked(input)).toBe(false);
  });

  it('gives no basis to publish at Accept edits without Full auto → PR', async () => {
    const { input } = await requestTurn(OPEN_A_PR, false, ACCEPT_EDITS);

    expect(startBasis(input)).toBeNull();
    expect(publishAsked(input)).toBe(false);
  });

  it('publishes on the mode basis in Bypass permissions', async () => {
    const { input } = await requestTurn(OPEN_A_PR, false, BYPASS);

    expect(startBasis(input)).toBe('mode');
  });

  it('gives a piece of that turn no request either', async () => {
    const { postId, runId } = await requestTurn(OPEN_A_PR, false, ACCEPT_EDITS);
    const pieceId = randomUUID();
    await t.db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
         role, prompt, mode, level, agent_mode)
       VALUES ($1, $2, $3, 'claude', 'queued', $4, 'builder', 'Build it.', 'do', 'hands-off',
         'acceptEdits')`,
      [pieceId, api, postId, runId],
    );

    const piece = await loadRunInput(t.db, pieceId);

    expect(publishGrant(piece).requested).toBe(false);
    expect(startBasis(piece)).toBeNull();
    expect((await actionFacts(t.db, pieceId, 'post_slack')).requested).toBe(false);
  });

  it('is not a PR follow-up round and has no follow-up grant', async () => {
    const { input } = await requestTurn(OPEN_A_PR, false, ACCEPT_EDITS);

    expect(input.followUpRound).toBe(false);
    expect(publishGrant(input).followUp).toBeNull();
  });
});

describe('"post to Slack" written by another chat', () => {
  it('raises a confirm card at Accept edits', async () => {
    const { runId } = await requestTurn(POST_TO_SLACK, false, ACCEPT_EDITS);

    const facts = await actionFacts(t.db, runId, 'post_slack');

    expect(facts).toEqual({ posture: 'edits', requested: false });
    expect(actionPath(facts)).toBe('confirm');
  });

  it('still follows the receiving chat’s mode in Bypass permissions', async () => {
    const { runId } = await requestTurn(POST_TO_SLACK, false, BYPASS);

    const facts = await actionFacts(t.db, runId, 'post_slack');

    expect(facts.requested).toBe(false);
    expect(actionPath(facts)).toBe('perform');
  });

  it('reads as not the user’s once the outpost is deleted', async () => {
    const { runId } = await requestTurn(POST_TO_SLACK, true, ACCEPT_EDITS);
    await t.db.query('DELETE FROM outposts WHERE id = $1', [outpostId]);

    expect((await actionFacts(t.db, runId, 'post_slack')).requested).toBe(false);
    expect(publishGrant(await loadRunInput(t.db, runId)).requested).toBe(false);
  });
});

describe('a request the user typed in the outpost', () => {
  it('counts as the user asking to publish', async () => {
    const { input } = await requestTurn(OPEN_A_PR, true, ACCEPT_EDITS);

    expect(publishGrant(input).requested).toBe(true);
    expect(startBasis(input)).toBe('requested');
    expect(publishAsked(input)).toBe(true);
  });

  it('counts as the user asking for a Spark action, so no card at Accept edits', async () => {
    const { runId } = await requestTurn(POST_TO_SLACK, true, ACCEPT_EDITS);

    const facts = await actionFacts(t.db, runId, 'post_slack');

    expect(facts).toEqual({ posture: 'edits', requested: true });
    expect(actionPath(facts)).toBe('perform');
  });
});

describe('a message typed in the chat', () => {
  it('counts exactly as before', async () => {
    const publish = await typedTurn(OPEN_A_PR, ACCEPT_EDITS);

    expect(publish.input.outpostRequest).toBeNull();
    expect(startBasis(publish.input)).toBe('requested');
    expect(publishAsked(publish.input)).toBe(true);
  });

  it('counts exactly as before for a Spark action', async () => {
    const slack = await typedTurn(POST_TO_SLACK, ACCEPT_EDITS);

    expect(await actionFacts(t.db, slack.runId, 'post_slack')).toEqual({
      posture: 'edits',
      requested: true,
    });
  });

  it('gives no basis at Accept edits when it does not ask to publish', async () => {
    const plain = await typedTurn('Add the endpoint.', ACCEPT_EDITS);

    expect(startBasis(plain.input)).toBeNull();
    expect(publishAsked(plain.input)).toBe(false);
  });
});
