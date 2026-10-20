import type { SessionUpdate } from '@agentclientprotocol/sdk';
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
  return subagentMark(update) !== null;
}
