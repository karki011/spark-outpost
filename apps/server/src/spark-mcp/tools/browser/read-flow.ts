import type { BrowserPlace } from '@spark-outpost/contracts';
import type { SparkToolContext } from '../../tool.ts';
import { auditBrowser, pageParts, type BrowserDecision } from './context.ts';
import { clearExternalRead, WAITING_FOR_PAGE } from './gate.ts';

export interface PageFacts {
  tabId: string;
  url: string;
  title: string;
  place: BrowserPlace;
  owner: 'agent' | 'user';
}

export type PageWhat = 'read' | 'screenshot' | 'logs';

export type Cleared =
  | { cleared: true; decision: BrowserDecision }
  | { cleared: false; result: Record<string, unknown> };

export async function clearPage(
  context: SparkToolContext,
  tool: string,
  what: PageWhat,
  page: PageFacts,
): Promise<Cleared> {
  if (page.place === 'local') {
    auditBrowser(context, {
      tool,
      action: what,
      page: page.url,
      place: 'local',
      decision: 'local',
    });
    return { cleared: true, decision: 'local' };
  }
  const { origin, path } = pageParts(page.url);
  const clearance = await clearExternalRead(context, {
    action: 'read_page',
    origin,
    path,
    title: page.title.slice(0, 300),
    what,
  });
  auditBrowser(context, {
    tool,
    action: what,
    page: page.url,
    place: 'external',
    decision: clearance.decision,
    ...(clearance.approvalId ? { detail: { approvalId: clearance.approvalId } } : {}),
  });
  if (clearance.cleared) {
    context.scope.observations?.record({ source: 'web_page', label: `web page ${origin}` });
    return { cleared: true, decision: clearance.decision };
  }
  const waiting = clearance.decision === 'waiting_for_user';
  return {
    cleared: false,
    result: {
      outcome: waiting ? 'waiting_for_user' : 'declined',
      tab: page.tabId,
      site: origin,
      message: waiting
        ? WAITING_FOR_PAGE
        : 'The user did not allow reading this site. Do not try again unless they ask.',
    },
  };
}
