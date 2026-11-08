import * as acp from '@agentclientprotocol/sdk/unstable';

export const FOUR_KINDS_TRIGGER = '#fourkinds';

export const FOUR_KINDS_OPTIONS: acp.PermissionOption[] = [
  { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
  {
    optionId: 'yes-always',
    name: "Yes, and don't ask again for npm run lint commands",
    kind: 'allow_always',
  },
  { optionId: 'no', name: 'No', kind: 'reject_once' },
  { optionId: 'no-always', name: "No, and don't ask again", kind: 'reject_always' },
];

export async function fourKindsTurn(
  sessionId: string,
  cwd: string,
  client: acp.AgentContext,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason> {
  const toolCall: acp.ToolCallUpdate = {
    toolCallId: 'four-1',
    title: 'npm run lint',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'npm run lint', cwd },
  };
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'tool_call', ...toolCall } as acp.SessionUpdate,
  });
  const answer = await client.request(acp.methods.client.session.requestPermission, {
    sessionId,
    toolCall,
    options: FOUR_KINDS_OPTIONS,
  });
  const chose = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
  await client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'four-1',
      status: chose.startsWith('yes') ? 'completed' : 'failed',
    },
  });
  await say(`permission=${chose}`);
  return 'end_turn';
}
