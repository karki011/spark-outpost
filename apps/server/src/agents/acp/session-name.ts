import * as acp from '@agentclientprotocol/sdk/unstable';

export const DEFAULT_SESSION_NAME = 'Spark Outpost chat';
const MAX_SESSION_NAME = 200;

export function namesSessions(init: acp.InitializeResponse): boolean {
  const title = init.agentCapabilities?.sessionCapabilities?.title;
  return title !== undefined && title !== null;
}

export function sessionName(title: string | undefined): string {
  const trimmed = title?.trim().slice(0, MAX_SESSION_NAME) ?? '';
  return trimmed === '' ? DEFAULT_SESSION_NAME : trimmed;
}

export async function nameNewSession(
  ctx: Pick<acp.ClientContext, 'request'>,
  init: acp.InitializeResponse,
  sessionId: string,
  title: string | undefined,
): Promise<void> {
  if (!namesSessions(init)) return;
  try {
    await ctx.request(acp.methods.agent.session.setTitle, {
      sessionId,
      title: sessionName(title),
    });
  } catch {
    return;
  }
}
