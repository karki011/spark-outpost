import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';
import type { ProviderMessage, ProviderTurn, SteerRequests } from '../../providers/provider.ts';

import { followUpBlocks, promptSupport, type PromptSupport } from './conversation-prompt.ts';

type Requester = Pick<acp.ClientContext, 'request'>;

export const STEER_METHOD = '_session/steering';

const advertisedSchema = z.object({ steering: z.object({ supported: z.literal(true) }) });
const steerResponseSchema = z.object({ outcome: z.string() });

export function steeringSupported(init: acp.InitializeResponse): boolean {
  return advertisedSchema.safeParse(init._meta).success;
}

async function steer(
  ctx: Requester,
  sessionId: string,
  message: ProviderMessage,
  support: PromptSupport,
): Promise<boolean> {
  const response = await ctx
    .request<unknown, unknown>(STEER_METHOD, {
      sessionId,
      prompt:
        typeof message === 'string'
          ? [{ type: 'text', text: message }]
          : followUpBlocks(message.text, { attachments: message.attachments, support }),
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
  return steering.attach((text) => steer(ctx, sessionId, text, promptSupport(init)));
}

export async function nextMessage(
  turn: ProviderTurn,
  stopReason: acp.StopReason,
  signal: AbortSignal,
): Promise<ProviderMessage | null> {
  if (!turn.inbox || stopReason !== 'end_turn' || signal.aborted) return null;
  return turn.inbox.take();
}

export function untilFailure(sent: Promise<unknown>): Promise<never> {
  return sent.then(() => new Promise<never>(() => undefined));
}
