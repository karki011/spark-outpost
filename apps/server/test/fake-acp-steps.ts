import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { FakeTurn } from './fake-acp-build.ts';

const STEPS_PATTERN = /#steps (\d+)/;

export async function stepsTurn(turn: FakeTurn): Promise<acp.StopReason | null> {
  const count = Number(STEPS_PATTERN.exec(turn.text)?.[1]);
  if (!Number.isInteger(count)) return null;
  await turn.update({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'hmm' },
  });
  for (let index = 1; index <= count; index++) {
    const toolCallId = `step-${index}`;
    await turn.update({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: `Read file ${index}`,
      kind: 'read',
      status: 'in_progress',
    });
    await turn.update({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `contents of file ${index}` } }],
    });
  }
  await turn.say(`Done with ${count} steps.`);
  return 'end_turn';
}
