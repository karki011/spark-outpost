import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';
import type { ProviderTurn, SteerRequests } from '../../providers/provider.ts';

type Requester = Pick<acp.ClientContext, 'request'>;

export const STEER_METHOD = '_session/steering';

const advertisedSchema = z.object({ steering: z.object({ supported: z.literal(true) }) });
const steerResponseSchema = z.object({ outcome: z.string() });

export function steeringSupported(init: acp.InitializeResponse): boolean {
  return advertisedSchema.safeParse(init._meta).success;
}

async function steer(ctx: Requester, sessionId: string, text: string): Promise<boolean> {
  const response = await ctx
    .request<unknown, unknown>(STEER_METHOD, {
      sessionId,
      prompt: [{ type: 'text', text }],
      _meta: { steering: { idleBehavior: 'promptRequired' } },
    })
    .catch(() => null);
  const parsed = steerResponseSchema.safeParse(response);
  return parsed.success && parsed.data.outcome === 'injected';
}

export function attachSteering(
  ctx: Requester,
  init: acp.InitializeResponse,
  sessionId: string,
  steering: SteerRequests | undefined,
): () => void {
  if (!steering || !steeringSupported(init)) return () => undefined;
  return steering.attach((text) => steer(ctx, sessionId, text));
}

export async function nextMessage(
  turn: ProviderTurn,
  stopReason: acp.StopReason,
  signal: AbortSignal,
): Promise<string | null> {
  if (!turn.inbox || stopReason !== 'end_turn' || signal.aborted) return null;
  return turn.inbox.take();
}

export function untilFailure(sent: Promise<unknown>): Promise<never> {
  return sent.then(() => new Promise<never>(() => undefined));
}
