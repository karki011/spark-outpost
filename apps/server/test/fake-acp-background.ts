import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';

type Say = (chunk: string, messageId?: string) => Promise<void>;

export const BACKGROUND_TRIGGER = '#background';
const FOREVER_TRIGGER = '#backgroundforever';
const LATER_MS = Number(process.env.FAKE_ACP_BACKGROUND_MS ?? 400);

function sender(client: acp.AgentContext) {
  return (sessionId: string, update: unknown) =>
    client.notify(acp.methods.client.session.update, { sessionId, update } as never);
}

async function cycleEnd(client: acp.AgentContext, rootId: string): Promise<void> {
  await client.notify('_claude/sdkMessage', {
    message: {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg-background',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      },
    },
  });
  await sender(client)(rootId, {
    sessionUpdate: 'usage_update',
    used: 2_000,
    size: 1_000_000,
    cost: { amount: 0.5, currency: 'USD' },
    _meta: { '_claude/origin': { kind: 'task-notification' } },
  });
}

async function reportLater(client: acp.AgentContext, rootId: string): Promise<void> {
  const send = sender(client);
  await delay(LATER_MS);
  await send(rootId, {
    sessionUpdate: 'async_task_state_update',
    asyncTaskId: 'task-1',
    state: 'completed',
  });
  await send(rootId, {
    sessionUpdate: 'subagent_spawned',
    subagentSessionId: 'bg-1:generation:2',
    name: 'Schema',
    task: '<task-notification>done</task-notification>',
    capabilities: {},
  });
  await send(rootId, {
    sessionUpdate: 'subagent_state_update',
    subagentSessionId: 'bg-1:generation:2',
    state: 'completed',
  });
  await send(rootId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'm-later',
    content: { type: 'text', text: 'Schema finished: turns live in events.' },
  });
  await cycleEnd(client, rootId);
}

export const LATER_TRIGGER = '#later';

async function wakeLater(client: acp.AgentContext, rootId: string, text: string): Promise<void> {
  const send = sender(client);
  await delay(LATER_MS);
  let checked = 'checked';
  if (text.includes('#laterask')) {
    const toolCall = { toolCallId: 'later-1', title: 'Write later.txt', kind: 'edit' as const };
    await send(rootId, { sessionUpdate: 'tool_call', ...toolCall, status: 'pending' });
    const answer = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: rootId,
      toolCall: { ...toolCall, status: 'pending' },
      options: [
        { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ],
    });
    checked = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
  }
  await send(rootId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'm-wake',
    content: { type: 'text', text: `Woke up on my own: ${checked}.` },
  });
  await cycleEnd(client, rootId);
}

export async function laterTurn(
  client: acp.AgentContext,
  rootId: string,
  text: string,
  say: Say,
): Promise<acp.StopReason> {
  await say("I'll check back on my own.");
  void wakeLater(client, rootId, text);
  return 'end_turn';
}

export async function backgroundTurn(
  client: acp.AgentContext,
  rootId: string,
  text: string,
  say: Say,
): Promise<acp.StopReason> {
  const send = sender(client);
  await say('Started the schema agent. ');
  await send(rootId, {
    sessionUpdate: 'subagent_spawned',
    subagentSessionId: 'bg-1',
    name: 'Schema',
    task: 'Check how turns are stored',
    capabilities: {},
  });
  await send(rootId, {
    sessionUpdate: 'async_task_spawned',
    asyncTaskId: 'task-1',
    name: 'sleep 60',
    taskType: 'shell',
    description: 'sleep 60',
    showInTranscript: false,
    canStop: true,
  });
  await send('bg-1', {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'bg-call',
    status: 'completed',
    _meta: { claudeCode: { toolName: 'Bash', toolResponse: { backgroundTaskId: 'task-1' } } },
  });
  await send(rootId, {
    sessionUpdate: 'subagent_state_update',
    subagentSessionId: 'bg-1',
    state: 'completed',
  });
  await say("I'll send the write-up once it reports.");
  if (!text.includes(FOREVER_TRIGGER)) void reportLater(client, rootId);
  return 'end_turn';
}
