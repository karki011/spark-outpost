import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';

type Say = (chunk: string, messageId?: string) => Promise<void>;

export const SLEEP_TRIGGER = '#sleep';
const LONG_TRIGGER = '#sleeplong';
const SLEEP_MS = Number(process.env.FAKE_ACP_SLEEP_MS ?? 800);
const LONG_MS = 3_600_000;

function sender(client: acp.AgentContext, sessionId: string) {
  return (update: unknown) =>
    client.notify(acp.methods.client.session.update, { sessionId, update } as never);
}

async function scheduleWakeup(send: ReturnType<typeof sender>, delayMs: number): Promise<number> {
  const toolCallId = 'wake-1';
  const scheduledFor = Date.now() + delayMs;
  const toolName = { claudeCode: { toolName: 'ScheduleWakeup' } };
  await send({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'ScheduleWakeup',
    kind: 'other',
    status: 'pending',
    rawInput: {},
    _meta: toolName,
  });
  await send({
    sessionUpdate: 'tool_call_update',
    toolCallId,
    _meta: {
      claudeCode: {
        toolName: 'ScheduleWakeup',
        toolResponse: {
          scheduledFor,
          clampedDelaySeconds: Math.round(delayMs / 1000),
          wasClamped: false,
        },
      },
    },
  });
  await send({
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    rawOutput: `Next wakeup scheduled for 10:48:00 (in ${Math.round(delayMs / 1000)}s). Nothing more to do this turn.`,
    _meta: toolName,
  });
  return scheduledFor;
}

async function wake(send: ReturnType<typeof sender>, at: number): Promise<void> {
  await delay(Math.max(0, at - Date.now()) + 50);
  await send({ sessionUpdate: 'usage_update', used: 1_600, size: 1_000_000 });
  await send({
    sessionUpdate: 'agent_message_chunk',
    messageId: 'm-awake',
    content: { type: 'text', text: 'Awake: the build is green.' },
  });
  await send({
    sessionUpdate: 'usage_update',
    used: 1_700,
    size: 1_000_000,
    cost: { amount: 0.25, currency: 'USD' },
  });
}

export async function sleepTurn(
  client: acp.AgentContext,
  sessionId: string,
  text: string,
  say: Say,
): Promise<acp.StopReason> {
  const send = sender(client, sessionId);
  const long = text.includes(LONG_TRIGGER);
  const at = await scheduleWakeup(send, long ? LONG_MS : SLEEP_MS);
  await say('Sleeping until the build is done.');
  await send({
    sessionUpdate: 'usage_update',
    used: 1_500,
    size: 1_000_000,
    cost: { amount: 0.25, currency: 'USD' },
    _meta: { '_claude/origin': { kind: 'human' } },
  });
  if (!long) void wake(send, at);
  return 'end_turn';
}
