import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { subagentMark } from './subagent-stream.ts';

const WORK_UPDATES = new Set<SessionUpdate['sessionUpdate']>([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]);

export function startsAgentCycle(update: SessionUpdate): boolean {
  if (WORK_UPDATES.has(update.sessionUpdate)) return true;
  const mark = subagentMark(update);
  return mark !== null && !(mark.event === 'task' && mark.turn === true && mark.ended);
}
