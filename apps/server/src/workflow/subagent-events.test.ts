import { describe, expect, it } from 'vitest';
import { EventType, parseRunEvent, type RunEvent } from '@spark-outpost/contracts';
import { verifyStream } from '../../test/agui-conformance.ts';
import type { Append } from './agent-turn.ts';
import { trackOpenSpans } from './open-spans.ts';
import { runEvents } from './run-events.ts';
import { attributed, subagentBracket } from './subagent-events.ts';

const identity = { runId: 'chat-run', threadId: 'thread' };
const WORKER = 'worker-run';

function recorder(): { events: RunEvent[]; append: Append } {
  const events: RunEvent[] = [];
  return {
    events,
    append: (event) => {
      events.push(event);
      return Promise.resolve(events.length);
    },
  };
}

async function answered(outcome: 'succeeded' | 'failed' | 'cancelled') {
  const chat = recorder();
  const worker = recorder();
  const bracket = subagentBracket(chat.append, WORKER, { name: 'conversation' });
  const append = bracket.mirroring(worker.append);
  await chat.append(runEvents.started(identity));
  await append(runEvents.started({ ...identity, runId: WORKER, parentRunId: identity.runId }));
  await bracket.start();
  await append(runEvents.stepStarted('Read a file'));
  await append(runEvents.textStart('m1'));
  await append(runEvents.textContent('m1', 'Still building.'));
  await append(runEvents.stepFinished('Read a file'));
  await append(runEvents.textEnd('m1'));
  await bracket.finish({ outcome, error: outcome === 'failed' ? 'The agent crashed.' : null });
  await chat.append(runEvents.finished(identity));
  return { chat: chat.events, worker: worker.events };
}

describe('a worker announced in the chat run', () => {
  it('brackets its reply and marks every copied event with its run', async () => {
    const { chat, worker } = await answered('succeeded');
    expect(chat.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.SUBAGENT_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.SUBAGENT_FINISHED,
      EventType.RUN_FINISHED,
    ]);
    expect(chat.slice(1, -1).every((event) => 'subagentRunId' in event)).toBe(true);
    expect(worker[0]).toMatchObject({ parentRunId: identity.runId });
    expect(worker.some((event) => 'subagentRunId' in event)).toBe(false);
    await verifyStream(chat);
  });

  it('reports a failed and a stopped worker without ending the chat run', async () => {
    const failed = (await answered('failed')).chat;
    expect(failed.at(-2)).toMatchObject({
      type: EventType.SUBAGENT_ERROR,
      message: 'The agent crashed.',
    });
    await verifyStream(failed);
    const stopped = (await answered('cancelled')).chat;
    expect(stopped.at(-2)).toMatchObject({ type: EventType.SUBAGENT_ERROR, code: 'cancelled' });
    await verifyStream(stopped);
  });

  it('closes a worker and its open reply when the chat run ends first', async () => {
    const spans = trackOpenSpans();
    const open = [
      runEvents.started(identity),
      { type: EventType.SUBAGENT_STARTED, subagentRunId: WORKER, name: 'conversation' } as RunEvent,
      attributed(runEvents.textStart('m1'), WORKER)!,
    ];
    for (const event of open) spans.observe(event);
    const closing = spans.closers();
    expect(closing.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.SUBAGENT_ERROR,
    ]);
    await verifyStream([...open, ...closing, runEvents.cancelled(identity)]);
    expect(spans.closers()).toEqual([]);
  });

  it('leaves run-scoped and custom events unattributed', () => {
    expect(attributed(runEvents.started(identity), WORKER)).toBeNull();
    expect(attributed(runEvents.error('x', 'y'), WORKER)).toBeNull();
    expect(attributed(runEvents.stepStarted('s'), WORKER)).toMatchObject({ subagentRunId: WORKER });
  });

  it('still reads a run stored before workers named their parent', () => {
    expect(parseRunEvent({ type: 'RUN_STARTED', runId: 'r', threadId: 't' })).not.toBeNull();
  });
});
