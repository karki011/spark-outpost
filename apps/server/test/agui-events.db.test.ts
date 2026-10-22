import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventType, stepMark, type RunEvent } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { expectConformantRun, storedEvents } from './agui-conformance.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['codex', provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function send(content: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content },
    { provider: 'codex' },
  );
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function settled(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 20_000);
}

async function seen(runId: string, type: EventType, count: number) {
  await eventually(async () => {
    const events = await storedEvents(t.db, runId);
    return events.filter((event) => event.type === type).length >= count;
  }, 20_000);
}

const ofType = <Type extends EventType>(events: readonly RunEvent[], type: Type) =>
  events.filter((event): event is Extract<RunEvent, { type: Type }> => event.type === type);

const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';

describe('AG-UI events from an ACP agent', { timeout: 40_000 }, () => {
  it('stores thinking as one reasoning span inside the Thinking step, with secrets redacted', async () => {
    const { conversationId, runId } = await send('#twins');
    expect((await settled(runId)).status).toBe('succeeded');
    const events = await storedEvents(t.db, runId);
    await expectConformantRun(t.db, runId);

    const types = events.map((event) => event.type);
    const span = ofType(events, EventType.REASONING_START)[0]!;
    expect(ofType(events, EventType.REASONING_START)).toHaveLength(1);
    const thinking = events.findIndex(
      (event) => event.type === EventType.STEP_STARTED && event.stepName === 'Thinking',
    );
    expect(types.indexOf(EventType.REASONING_START)).toBe(thinking + 1);
    expect(types.slice(types.indexOf(EventType.REASONING_MESSAGE_END)).slice(0, 3)).toEqual([
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.STEP_FINISHED,
    ]);
    const thought = ofType(events, EventType.REASONING_MESSAGE_CONTENT);
    expect(thought.every((event) => event.messageId === span.messageId)).toBe(true);
    expect(thought.map((event) => event.delta).join('')).toBe(
      'Two searches at once.\nThe key is [redacted:api_key]\n',
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);

    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.activity[runId]?.find((step) => step.name === 'Thinking')).toEqual({
      name: 'Thinking',
      done: true,
      reasoningId: span.messageId,
    });
    const app = createTestApp(t);
    const read = (id: string) =>
      request(app).get(`/api/runs/${runId}/reasoning/${id}`).set(LOCAL_HEADERS);
    expect((await read(span.messageId).expect(200)).body).toEqual({
      text: 'Two searches at once.\nThe key is [redacted:api_key]\n',
    });
    await read(randomUUID()).expect(404);
  });

  it('records each tool call by id and shows two calls with one name as a single step', async () => {
    const { conversationId, runId } = await send('#twins');
    expect((await settled(runId)).status).toBe('succeeded');
    const events = await storedEvents(t.db, runId);

    expect(ofType(events, EventType.TOOL_CALL_START)).toMatchObject([
      { toolCallId: 'twin-1', toolCallName: 'Search the docs' },
      { toolCallId: 'twin-2', toolCallName: 'Search the docs' },
    ]);
    expect(ofType(events, EventType.TOOL_CALL_ARGS)).toMatchObject([
      { toolCallId: 'twin-1', delta: '{"query":"steps"}' },
      { toolCallId: 'twin-2', delta: '{"query":"tools"}' },
    ]);
    expect(ofType(events, EventType.TOOL_CALL_RESULT)).toMatchObject([
      { toolCallId: 'twin-1', content: 'steps found' },
      { toolCallId: 'twin-2', content: 'tools found' },
    ]);
    const named = (event: RunEvent) => 'stepName' in event && event.stepName === 'Search the docs';
    const searchSteps = [EventType.STEP_STARTED, EventType.STEP_FINISHED].map((type) =>
      events.filter((event) => event.type === type && named(event)),
    );
    expect(searchSteps.map((steps) => steps.map(stepMark))).toEqual([
      [{ toolCallId: 'twin-1' }],
      [{ toolCallId: 'twin-1' }],
    ]);
    const lastResult = events.findLastIndex((event) => event.type === EventType.TOOL_CALL_RESULT);
    expect(events[lastResult + 1]).toMatchObject({ type: EventType.STEP_FINISHED });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.activity[runId]?.slice(-2)).toEqual([
      expect.objectContaining({ name: 'Thinking', done: true }),
      expect.objectContaining({ name: 'Search the docs', done: true }),
    ]);
  });

  it('never stores what a tool read from a secret file', async () => {
    const { runId } = await send('#secret');
    expect((await settled(runId)).status).toBe('succeeded');
    const events = await storedEvents(t.db, runId);
    await expectConformantRun(t.db, runId);
    expect(ofType(events, EventType.TOOL_CALL_ARGS)).toMatchObject([
      { toolCallId: 's1', delta: '{"command":["printenv"]}' },
      { toolCallId: 's2', delta: '{"file_path":"/work/app/.env"}' },
    ]);
    const results = ofType(events, EventType.TOOL_CALL_RESULT);
    expect(results[0]?.content).toBe('token [redacted:github_token]');
    expect(results[1]).toMatchObject({ toolCallId: 's2', content: '[redacted:secret_file]' });
    const stored = JSON.stringify(events);
    for (const secret of [SECRET, 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'hello-from-dotenv']) {
      expect(stored).not.toContain(secret);
    }
  });

  it('closes an open tool call, its step and the thinking when the run is stopped twice', async () => {
    const { conversationId, runId } = await send('#hang');
    await seen(runId, EventType.REASONING_START, 2);
    await stopRun(t.db, runId);
    await stopRun(t.db, runId);
    expect((await settled(runId)).status).toBe('cancelled');
    await expectConformantRun(t.db, runId);

    const events = await storedEvents(t.db, runId);
    const closing = events.slice(-3);
    expect(closing.map((event) => event.type)).toEqual([
      EventType.STEP_FINISHED,
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ]);
    expect(ofType(closing, EventType.STEP_FINISHED).map(stepMark)).toEqual([
      { toolCallId: 'twin-1', interrupted: true },
      { interrupted: true },
    ]);
    expect(ofType(events, EventType.REASONING_END)).toHaveLength(2);
    expect(ofType(events, EventType.TOOL_CALL_RESULT).map((event) => event.toolCallId)).toEqual([
      'twin-1',
    ]);
    expect(ofType(events, EventType.RUN_FINISHED)).toHaveLength(1);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.activity[runId]?.slice(-3).map((step) => step.done)).toEqual([
      true,
      false,
      false,
    ]);
  });
});
