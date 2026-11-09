import * as acp from '@agentclientprotocol/sdk/unstable';
import { z } from 'zod';
import { addressSecretFiles } from '../../approvals/secret-send.ts';
import { openAddressRefusal } from '../../approvals/web-address.ts';
import { rpcIdOf, toolCallOf, type QuestionContext } from './questions.ts';

const urlElicitationSchema = z.object({
  mode: z.literal('url'),
  url: z.string().min(1),
  elicitationId: z.string().min(1),
  message: z.string(),
  sessionId: z.string().optional(),
});

export type UrlElicitation = z.infer<typeof urlElicitationSchema>;

export function urlElicitation(params: acp.CreateElicitationRequest): UrlElicitation | null {
  const parsed = urlElicitationSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
}

export function elicitationIdOf(params: acp.CreateElicitationRequest): string | null {
  return urlElicitation(params)?.elicitationId ?? null;
}

function readRequest(params: acp.CreateElicitationRequest, ctx: QuestionContext): UrlElicitation {
  const request = urlElicitation(params);
  if (request) return request;
  ctx.note(`${ctx.agent} asked Spark to open an address it didn't send.`);
  throw acp.RequestError.invalidParams(undefined, 'A url elicitation needs url and elicitationId.');
}

export async function askToOpen(
  params: acp.CreateElicitationRequest,
  ctx: QuestionContext,
): Promise<acp.CreateElicitationResponse> {
  const request = readRequest(params, ctx);
  if (!request.sessionId) {
    ctx.note(`${ctx.agent} asked Spark to open an address outside a chat, so it was skipped.`);
    return { action: 'decline' };
  }
  const refusal = openAddressRefusal(request.url);
  if (refusal) {
    ctx.note(`Spark didn't open an address ${ctx.agent} asked for: ${refusal}.`);
    return { action: 'decline' };
  }
  if (!ctx.gate) {
    ctx.note(`${ctx.agent} asked to open an address this run can't show, so it was skipped.`);
    return { action: 'decline' };
  }
  if (ctx.signal.aborted || ctx.agentCancel.aborted) return { action: 'cancel' };
  const secretFiles = await addressSecretFiles(request.url, ctx.roots);
  const action = await ctx.gate.open(
    {
      toolCallId: toolCallOf(params),
      rpcId: rpcIdOf(ctx.requestId),
      agent: ctx.agent,
      url: request.url.trim(),
      message: request.message,
      secretFiles,
    },
    ctx.signal,
    ctx.agentCancel,
  );
  return { action };
}
