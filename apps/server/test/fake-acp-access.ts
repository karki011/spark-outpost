import * as acp from '@agentclientprotocol/sdk';

export const AUTH_STATUS_METHOD = '_auth/status_update';

export function rejectionBody(model: string): string {
  return `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The '${model}' model is not supported when using Codex with a ChatGPT account."}}`;
}

const rejected = JSON.parse(process.env.FAKE_ACP_REJECT_MODELS ?? '[]') as string[];

function requestFailure(title: string) {
  return {
    jetbrains: {
      air: {
        version: 1,
        sessionFailure: {
          id: 't:error',
          revision: 1,
          category: 'request',
          severity: 'error',
          title,
        },
      },
    },
  };
}

type Update = (value: acp.SessionUpdate) => Promise<void>;

export async function rejectedTurn(
  text: string,
  model: string,
  update: Update,
): Promise<acp.PromptResponse | null> {
  if (!rejected.includes(model)) return null;
  if (text.includes('#toolfirst')) {
    const call = { toolCallId: 'early', title: 'Read notes.txt', kind: 'read' as const };
    await update({ sessionUpdate: 'tool_call', ...call, status: 'in_progress' });
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 'early', status: 'completed' });
  }
  if (process.env.FAKE_ACP_REJECT_STYLE === 'claude') {
    throw acp.RequestError.internalError(
      { errorKind: 'model_not_found' },
      `There's an issue with the selected model (${model}). It may not exist or you may not have access to it.`,
    );
  }
  return { stopReason: 'end_turn', _meta: requestFailure(rejectionBody(model)) };
}

export function pushAuthStatus(client: acp.AgentContext): void {
  const status = process.env.FAKE_ACP_AUTH_STATUS;
  if (status) void client.notify(AUTH_STATUS_METHOD, JSON.parse(status) as Record<string, unknown>);
}

const EXIT_AFTER_MS = 20;

export async function signedOut(update: Update, says: boolean): Promise<never> {
  if (says) {
    await update({
      sessionUpdate: 'session_info_update',
      _meta: {
        jetbrains: {
          air: {
            version: 1,
            sessionFailure: {
              id: 't:session-error',
              revision: 1,
              category: 'access',
              severity: 'error',
              title: 'Sign in to continue using Claude.',
              details: 'Failed to authenticate: OAuth session expired and could not be refreshed',
              actions: ['login'],
            },
          },
        },
      },
    });
  }
  setTimeout(() => process.exit(1), EXIT_AFTER_MS);
  throw new acp.RequestError(-32603, 'Internal error', { errorKind: 'authentication_failed' });
}
