import * as acp from '@agentclientprotocol/sdk';

type Say = (chunk: string) => Promise<void>;

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
  if (hold) await untilCancelled(hold);
  await spawn('sub-1', 'sub-3', 'Nested', 'Look deeper');
  await tool('sub-3', 'c3', 'Read deep.ts');
  await done('sub-3', 'c3');
  await end('sub-1', 'sub-3', 'completed');
  await tool('sub-2', 'c2', 'Read tests.ts');
  await done('sub-1', 'c1');
  await end(rootId, 'sub-1', 'completed');
  await end(rootId, 'sub-2', 'failed');
  await say('All done');
  return 'end_turn';
}
