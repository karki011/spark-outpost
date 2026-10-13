import type { ActPageAction, OpenPageAction } from '@spark-outpost/contracts';
import { parseBrowserUrl } from '@spark-outpost/contracts';
import { secretFilesIn } from '../../../approvals/secret-send.ts';
import type { SparkToolContext } from '../../tool.ts';
import type { BrowserDecision } from './context.ts';
import { clearSiteAction, WAITING_FOR_PAGE } from './gate.ts';

export interface SiteSend {
  text: string;
  subject: string;
  roots: readonly string[];
}

export interface BrowseAsk {
  url: string;
  userTab?: boolean;
  send: SiteSend | null;
}

export type Browsed =
  | { cleared: true; decision: BrowserDecision; approvalId?: string | undefined }
  | { cleared: false; decision: BrowserDecision; result: Record<string, unknown> };

export const DECLINED_SITE =
  'The user did not allow this on that site. Do not try again unless they ask.';

const RAN_UNASKED: ReadonlySet<BrowserDecision> = new Set(['mode', 'allowed_earlier']);

function hostOf(url: string): string {
  return parseBrowserUrl(url)?.host ?? 'a web site';
}

async function readBefore(context: SparkToolContext, origin: string): Promise<string[]> {
  const labels = (await context.scope.observations?.labels()) ?? [];
  return labels.filter((label) => label !== `web page ${origin}`);
}

export async function clearBrowse(
  context: SparkToolContext,
  action: OpenPageAction | ActPageAction,
  ask: BrowseAsk,
): Promise<Browsed> {
  const { send } = ask;
  const secretFiles = send ? await secretFilesIn(send.text, send.roots) : [];
  const observed = send ? await readBefore(context, action.origin) : [];
  const clearance = await clearSiteAction(context, action, {
    ...(ask.userTab ? { userTab: true } : {}),
    secretFiles,
    observed,
  });
  const target = `to ${hostOf(ask.url)}`;
  if (send && observed.length > 0 && clearance.approvalId) {
    context.scope.observations?.egressAsked({
      approvalId: clearance.approvalId,
      subject: send.subject,
      reason: null,
      observed,
      sendsTo: target,
    });
  }
  if (clearance.cleared) {
    if (send && observed.length > 0 && RAN_UNASKED.has(clearance.decision)) {
      context.scope.observations?.sentOut({
        toolCallId: null,
        subject: send.subject,
        target,
        observed,
      });
    }
    return { cleared: true, decision: clearance.decision, approvalId: clearance.approvalId };
  }
  const waiting = clearance.decision === 'waiting_for_user';
  return {
    cleared: false,
    decision: clearance.decision,
    result: {
      outcome: waiting ? 'waiting_for_user' : 'declined',
      site: action.origin,
      message: waiting ? WAITING_FOR_PAGE : DECLINED_SITE,
    },
  };
}
