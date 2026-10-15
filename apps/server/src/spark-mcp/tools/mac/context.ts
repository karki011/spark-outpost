import { macRefusalLine, redactText, type MacApp } from '@spark-outpost/contracts';
import { macRunRefusal, type MacRefusedRun } from '../../../mac-control/offered.ts';
import { MacHostError, type MacHost } from '../../../mac-control/host-client.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';

export class MacToolError extends SparkToolError {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

const audited = new WeakSet<Error>();

export function alreadyAudited<E extends Error>(error: E): E {
  audited.add(error);
  return error;
}

export interface MacSession {
  host: MacHost;
  chatId: string;
  runId: string | null;
}

const RUN_REFUSALS: Record<MacRefusedRun, string> = {
  off: 'Mac control is turned off. The user can turn it on in Settings → Mac control on their Mac.',
  remote:
    'Mac control is not available in a turn started from a paired device. It works only from the Mac.',
  child: 'Mac control belongs to the chat’s own turn; a child run gets none.',
  read_only: 'Mac control is not available in this read-only session.',
  no_chat: 'Mac control belongs to a chat, and this session has none.',
};

export async function macSession(context: SparkToolContext): Promise<MacSession> {
  const host = context.deps.mac;
  if (!host)
    throw new MacToolError(
      'no_shell',
      'Mac control is only available in the Spark Outpost Mac app.',
    );
  const refused = await macRunRefusal(context.deps.db, context.scope);
  if (refused) throw new MacToolError(refused, RUN_REFUSALS[refused]);
  return { host, chatId: context.scope.conversationId!, runId: context.scope.runId };
}

const HOST_MESSAGES: Partial<Record<MacHostError['code'], string>> = {
  timeout: 'Mac control took too long to answer. Try again.',
  cancelled: 'The Mac control call was cancelled.',
  invalid: 'Mac control sent an answer Spark cannot read.',
  gone: 'That ref is gone: its element or window closed. Read the app again.',
  changed: 'That ref now names a different element. Read the app again.',
};

export function asToolError(error: unknown): Error {
  if (!(error instanceof MacHostError)) return error as Error;
  return new MacToolError(error.code, redactText(HOST_MESSAGES[error.code] ?? error.message));
}

export function refusalFor(app: MacApp): string | null {
  return app.refused ? macRefusalLine(app.refused, app.name) : null;
}

export type MacDecision =
  | 'mode'
  | 'allowed_earlier'
  | 'user_allowed'
  | 'waiting_for_user'
  | 'user_declined'
  | 'refused'
  | 'failed';

export interface MacAuditEntry {
  tool: string;
  action: string;
  app: Pick<MacApp, 'name' | 'bundleId'> | null;
  decision: MacDecision;
  detail?: Record<string, unknown>;
}

export function auditMac(context: SparkToolContext, entry: MacAuditEntry): void {
  context.scope.actions?.audit?.message('harness', {
    method: 'spark/mac',
    params: {
      tool: entry.tool,
      runId: context.scope.runId,
      action: entry.action,
      app: entry.app?.name ?? null,
      bundleId: entry.app?.bundleId ?? null,
      decision: entry.decision,
      ...(entry.decision === 'mode' ? { ranWithoutReview: true } : {}),
      ...entry.detail,
    },
  });
}

function failureReason(error: unknown): string {
  if (error instanceof MacToolError) return error.reason;
  return error instanceof SparkToolError ? 'refused' : 'failed';
}

export async function auditFailures<T>(
  context: SparkToolContext,
  entry: { tool: string; action: string; app: string | null },
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && !audited.has(error)) {
      auditMac(context, {
        tool: entry.tool,
        action: entry.action,
        app: entry.app === null ? null : { name: entry.app.slice(0, 200), bundleId: null },
        decision: failureReason(error) === 'failed' ? 'failed' : 'refused',
        detail: { reason: failureReason(error) },
      });
    }
    throw error;
  }
}
