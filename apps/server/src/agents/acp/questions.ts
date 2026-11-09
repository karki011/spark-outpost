import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk/unstable';
import type { AgentForm } from '@spark-outpost/contracts';
import type { QuestionGate } from '../../providers/provider.ts';
import { agentForm } from './elicitation-form.ts';

export interface QuestionContext {
  gate: QuestionGate | null;
  agent: string;
  requestId: string | number | null | undefined;
  signal: AbortSignal;
  agentCancel: AbortSignal;
  note: (text: string) => void;
  roots: readonly string[];
}

const CANCEL: acp.CreateElicitationResponse = { action: 'cancel' };

export function toolCallOf(params: acp.CreateElicitationRequest): string {
  const scoped = 'toolCallId' in params ? params.toolCallId : null;
  return typeof scoped === 'string' && scoped ? scoped : `elicitation:${randomUUID()}`;
}

function readForm(params: acp.CreateElicitationRequest, ctx: QuestionContext): AgentForm {
  try {
    return agentForm(params);
  } catch (error) {
    const reason =
      error instanceof acp.RequestError
        ? error.message.replace(/^Invalid params: /, '')
        : 'it could not be read';
    ctx.note(`${ctx.agent} asked a question Spark can't show: ${reason}`);
    throw error;
  }
}

export function rpcIdOf(requestId: QuestionContext['requestId']): string | null {
  return requestId === undefined || requestId === null ? null : String(requestId);
}

export async function askQuestion(
  params: acp.CreateElicitationRequest,
  ctx: QuestionContext,
): Promise<acp.CreateElicitationResponse> {
  const form = readForm(params, ctx);
  if (!ctx.gate) {
    ctx.note(`${ctx.agent} asked a question this run can't show, so it was skipped.`);
    return { action: 'decline' };
  }
  if (ctx.signal.aborted) return CANCEL;
  return ctx.gate.ask(
    {
      toolCallId: toolCallOf(params),
      rpcId: rpcIdOf(ctx.requestId),
      agent: ctx.agent,
      form,
    },
    ctx.signal,
    ctx.agentCancel,
  );
}
