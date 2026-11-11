import * as acp from '@agentclientprotocol/sdk/unstable';
import { heldTitleTurn } from './fake-acp-subagents.ts';

type Say = (chunk: string, messageId?: string) => Promise<void>;

const LEAD_TITLES = /#agenttitle (\[.*\])/;
const CHILD_TITLE = /#childtitle (".*")/;

export function isTitleTrigger(text: string): boolean {
  return ['#heldtitle', '#agenttitle ', '#childtitle '].some((trigger) => text.includes(trigger));
}

export async function titleTurn(
  text: string,
  client: acp.AgentContext,
  sessionId: string,
  say: Say,
): Promise<acp.StopReason> {
  const send = (id: string, update: unknown) =>
    client.notify(acp.methods.client.session.update, { sessionId: id, update } as never);
  const leadTitles = LEAD_TITLES.exec(text)?.[1];
  const childTitle = CHILD_TITLE.exec(text)?.[1];
  if (leadTitles) {
    for (const title of JSON.parse(leadTitles) as unknown[]) {
      await send(sessionId, { sessionUpdate: 'session_info_update', title });
    }
    await say('Done.');
    return 'end_turn';
  }
  if (childTitle) {
    await send(sessionId, {
      sessionUpdate: 'subagent_spawned',
      subagentSessionId: 'sub-1',
      name: 'Explore',
      task: 'Find the routes',
      capabilities: {},
    });
    await send('sub-1', {
      sessionUpdate: 'session_info_update',
      title: JSON.parse(childTitle) as string,
    });
    await send(sessionId, {
      sessionUpdate: 'subagent_state_update',
      subagentSessionId: 'sub-1',
      state: 'completed',
    });
    await say('Done.');
    return 'end_turn';
  }
  return heldTitleTurn(say);
}
