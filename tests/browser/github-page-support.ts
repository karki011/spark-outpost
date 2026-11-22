import type { Page } from '@playwright/test';

export type Json = Record<string, unknown>;

const HOUR = 3_600_000;
export const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

export function pull(id: string, overrides: Json = {}): Json {
  return {
    id: `acme/api#${id}`,
    url: `https://github.com/acme/api/pull/${id}`,
    repo: 'acme/api',
    number: Number(id),
    title: `Pull request ${id}`,
    author: 'sam-kim',
    authorIsBot: false,
    mine: false,
    group: 'review_requested',
    draft: false,
    checks: 'passing',
    failingChecks: 0,
    conflict: false,
    behind: false,
    openThreads: null,
    changesRequested: false,
    approvedBy: [],
    waitingOn: ['lee-wu'],
    headSha: id.repeat(40),
    updatedAt: ago(30),
    createdAt: ago(80),
    headRef: `feature-${id}`,
    baseRef: 'main',
    labels: [],
    assignees: [],
    comments: 0,
    bodyPreview: '',
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    projectId: null,
    conversationId: null,
    ticket: null,
    unseen: false,
    updatedSinceSeen: false,
    ...overrides,
  };
}

export const ITEMS: Json[] = [
  pull('1', { title: 'Fix timezone in export filenames', unseen: true, updatedAt: ago(50) }),
  pull('2', {
    title: 'Add audit log table',
    ticket: { source: 'jira', key: 'API-198', title: 'Audit log', status: 'In review', url: null },
  }),
  pull('3', { title: 'Bump vite', author: 'dependabot[bot]', authorIsBot: true }),
  pull('4', { title: 'Bump zod', author: 'dependabot[bot]', authorIsBot: true }),
  pull('5', { title: 'Retry webhooks', group: 'needs_fixes', checks: 'failing', mine: true }),
  pull('6', { title: 'Move billing', group: 'waiting', mine: true, updatedAt: ago(72) }),
];

export function inbox(overrides: Json = {}): Json {
  return {
    connected: true,
    login: 'me',
    windowDays: 14,
    fetchedAt: ago(0.1),
    items: ITEMS,
    problems: [],
    ...overrides,
  };
}

export async function stubInbox(page: Page, body: Json, { remember = false } = {}) {
  if (!remember) {
    await page.addInitScript(() => {
      if (localStorage.getItem('spark.github.openPull') === null) {
        localStorage.setItem('spark.github.openPull', '');
      }
    });
  }
  const calls = { seen: [] as unknown[], window: [] as unknown[] };
  await page.route(/\/api\/github\/inbox(\?.*)?$/, (route) => route.fulfill({ json: body }));
  await page.route('**/api/github/inbox/seen', (route) => {
    const seen = route.request().postDataJSON() as { id: string };
    calls.seen.push(seen);
    const items = (body.items as Json[]).map((item) =>
      item.id === seen.id ? { ...item, unseen: false, updatedSinceSeen: false } : item,
    );
    return route.fulfill({ json: { ...body, items } });
  });
  await page.route('**/api/github/inbox/window', (route) => {
    calls.window.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...body, windowDays: 30 } });
  });
  return calls;
}
