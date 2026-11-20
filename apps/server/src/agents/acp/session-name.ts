import * as acp from '@agentclientprotocol/sdk/unstable';

export const DEFAULT_SESSION_NAME = 'Spark Outpost chat';
const MAX_SESSION_NAME = 200;

export interface SessionName {
  requested: string;
  stored: string;
}

export function namesSessions(init: acp.InitializeResponse): boolean {
  const title = init.agentCapabilities?.sessionCapabilities?.title;
  return title !== undefined && title !== null;
}

export function sessionName(title: string | undefined): string {
  const trimmed = title?.trim().slice(0, MAX_SESSION_NAME) ?? '';
  return trimmed === '' ? DEFAULT_SESSION_NAME : trimmed;
}

function storedTitle(response: unknown, requested: string): string {
  const title = (response as { title?: unknown } | null)?.title;
  return typeof title === 'string' && title.trim() !== '' ? title : requested;
}

export async function nameSession(
  ctx: Pick<acp.ClientContext, 'request'>,
  init: acp.InitializeResponse,
  sessionId: string,
  title: string | undefined,
  known: SessionName | null,
): Promise<SessionName | null> {
  if (!namesSessions(init)) return known;
  const requested = sessionName(title);
  if (known && (known.requested === requested || known.stored === requested)) return known;
  try {
    const response = await ctx.request(acp.methods.agent.session.setTitle, {
      sessionId,
      title: requested,
    });
    return { requested, stored: storedTitle(response, requested) };
  } catch {
    return known;
  }
}
