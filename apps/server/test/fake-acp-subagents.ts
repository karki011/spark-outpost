import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';

type Say = (chunk: string, messageId?: string) => Promise<void>;

function untilCancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

export async function subagentsTurn(
  client: acp.AgentContext,
  rootId: string,
  say: Say,
  hold: AbortSignal | null,
): Promise<acp.StopReason> {
  const send = (sessionId: string, update: unknown) =>
    client.notify(acp.methods.client.session.update, { sessionId, update } as never);
  const spawn = (parent: string, id: string, name: string, task: string) =>
    send(parent, {
      sessionUpdate: 'subagent_spawned',
      subagentSessionId: id,
      name,
      task,
      capabilities: {},
    });
  const end = (parent: string, id: string, state: string) =>
    send(parent, { sessionUpdate: 'subagent_state_update', subagentSessionId: id, state });
  const tool = (sessionId: string, toolCallId: string, title: string) =>
    send(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      kind: 'read',
      status: 'in_progress',
    });
  const done = (sessionId: string, toolCallId: string) =>
    send(sessionId, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });

  await say('Launching. ');
  await spawn(rootId, 'sub-1', 'Explore', 'Find the routes');
  await spawn(rootId, 'sub-2', 'Tests', 'Run the tests');
  await tool('sub-1', 'c1', 'Read routes.ts');
  await send('sub-1', {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'child words' },
  });
  if (hold) {
    await untilCancelled(hold).catch(async (stopped: unknown) => {
      await end(rootId, 'sub-1', 'cancelled');
      await end(rootId, 'sub-2', 'cancelled');
      throw stopped;
    });
  }
  await spawn('sub-1', 'sub-3', 'Nested', 'Look deeper');
  await tool('sub-3', 'c3', 'Read deep.ts');
  await done('sub-3', 'c3');
  await end('sub-1', 'sub-3', 'completed');
  await tool('sub-2', 'c2', 'Read tests.ts');
  await done('sub-1', 'c1');
  await send('sub-1', {
    sessionUpdate: 'tool_call',
    toolCallId: 'e1',
    title: 'Edit routes.ts',
    kind: 'edit',
    status: 'in_progress',
    locations: [{ path: '/work/app/src/routes.ts' }],
  });
  await done('sub-1', 'e1');
  await send('sub-1', {
    sessionUpdate: 'tool_call',
    toolCallId: 'x1',
    title: 'pnpm test',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'pnpm test' },
  });
  await done('sub-1', 'x1');
  await send('sub-1', {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'report',
    content: { type: 'text', text: 'Found 4 routes and moved them.' },
  });
  await send(rootId, {
    sessionUpdate: 'subagent_state_update',
    subagentSessionId: 'sub-1',
    state: 'completed',
    _meta: {
      claudeCode: {
        usage: { total_tokens: 3400, tool_uses: 3, duration_ms: 41_000 },
        summary: 'Moved 4 routes',
      },
    },
  });
  await end(rootId, 'sub-2', 'failed');
  await say('All done');
  return 'end_turn';
}

export async function subagentAsksTurn(
  client: acp.AgentContext,
  rootId: string,
  say: Say,
): Promise<acp.StopReason> {
  const notify = (sessionId: string, update: unknown) =>
    client.notify(acp.methods.client.session.update, { sessionId, update } as never);
  const tool = {
    toolCallId: 'p1',
    title: 'curl -sI https://example.com',
    kind: 'execute' as const,
  };
  await notify(rootId, {
    sessionUpdate: 'subagent_spawned',
    subagentSessionId: 'sub-1',
    name: 'Explore',
    task: 'Delegated task for Explore',
    capabilities: {},
  });
  await notify('sub-1', { sessionUpdate: 'tool_call', ...tool, status: 'pending' });
  await client.request(acp.methods.client.session.requestPermission, {
    sessionId: 'sub-1',
    toolCall: { ...tool, status: 'pending' },
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  });
  await notify('sub-1', {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'p1',
    status: 'completed',
  });
  await notify(rootId, {
    sessionUpdate: 'subagent_state_update',
    subagentSessionId: 'sub-1',
    state: 'completed',
  });
  await say('Asked and done');
  return 'end_turn';
}

export async function heldTitleTurn(say: Say): Promise<acp.StopReason> {
  await say('I started two sub-agents.\n\nTitle: Split the route work', 'held-1');
  await say('Both are done, and every test passes after the routes moved.', 'held-2');
  return 'end_turn';
}

export async function orphanedCommandTurn(
  client: acp.AgentContext,
  rootId: string,
  text: string,
  signal: AbortSignal,
): Promise<acp.StopReason> {
  const pidFile = /#orphan (\S+)/.exec(text)?.[1];
  if (!pidFile) return 'end_turn';
  const shell = spawn('/bin/sh', ['-c', 'sleep 600 & echo $! > "$0"; wait', pidFile], {
    stdio: 'ignore',
  });
  await client.notify(acp.methods.client.session.update, {
    sessionId: rootId,
    update: {
      sessionUpdate: 'subagent_spawned',
      subagentSessionId: 'sub-1',
      name: 'Runner',
      task: 'Run the slow script',
      capabilities: {},
    },
  } as never);
  await untilCancelled(signal).catch((stopped: unknown) => {
    shell.kill('SIGKILL');
    writeFileSync(`${pidFile}.stopped`, 'shell killed');
    throw stopped;
  });
  return 'end_turn';
}
