import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';

type Json = Record<string, unknown>;

const PULL = 'acme/api#1';
const HEAD = '1'.repeat(40);
const SHOTS = process.env.SPARK_DESIGN_SHOTS === '1';

const PROSE =
  'Looks careful overall. The retry loop backs off as expected, and the new test covers the timeout path. One question: should the last attempt log at warn rather than info?';

const DETAILED = [
  '## Summary',
  '',
  'Two small issues, nothing blocking.',
  '',
  '- `retry.ts` retries a 4xx response; only 5xx and timeouts should retry.',
  '- The changelog line is missing.',
  '',
  '<details>',
  '<summary>Files reviewed (3)</summary>',
  '',
  '| File | Note |',
  '| --- | --- |',
  '| src/retry.ts | Retries 4xx |',
  '| src/retry.test.ts | Good coverage |',
  '',
  '```ts',
  'const delays = [250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000]; // backoff for every attempt including the final one',
  '```',
  '',
  '</details>',
  '',
  'See https://github.com/acme/api/blob/main/docs/architecture/webhooks/retry-and-backoff-policy-for-outbound-deliveries.md for the policy.',
].join('\n');

function pull(id: string, overrides: Json = {}): Json {
  return {
    id: `acme/api#${id}`,
    url: `https://github.com/acme/api/pull/${id}`,
    repo: 'acme/api',
    number: Number(id),
    title: `Retry webhook deliveries ${id}`,
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
    waitingOn: [],
    headSha: id.repeat(40),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    additions: 12,
    deletions: 3,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    headRef: 'feature',
    baseRef: 'main',
    labels: [],
    assignees: [],
    comments: 0,
    bodyPreview: '',
    changedFiles: 2,
    projectId: null,
    conversationId: null,
    ticket: null,
    unseen: false,
    updatedSinceSeen: false,
    review: null,
    ...overrides,
  };
}

function review(overrides: Json = {}): Json {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    pull: PULL,
    headSha: HEAD,
    reviewer: { kind: 'spark', id: 'reviewer', name: 'PR Reviewer' },
    state: 'done',
    body: PROSE,
    error: null,
    requestedAt: new Date(Date.now() - 600_000).toISOString(),
    startedAt: new Date(Date.now() - 590_000).toISOString(),
    finishedAt: new Date(Date.now() - 500_000).toISOString(),
    posted: [],
    costUsd: null,
    tokens: null,
    ...overrides,
  };
}

interface Server {
  reviews: Json[];
  posts: Json[];
  stops: string[];
  listed: string[];
}

async function stubReviews(
  page: Page,
  start: { reviews?: Json[]; reviewer?: boolean; summary?: Json | null } = {},
): Promise<Server> {
  const server: Server = { reviews: start.reviews ?? [], posts: [], stops: [], listed: [] };
  const inbox = {
    connected: true,
    login: 'me',
    windowDays: 14,
    fetchedAt: new Date().toISOString(),
    items: [pull('1', { review: start.summary ?? null }), pull('2')],
    problems: [],
  };
  await page.route(/\/api\/github\/inbox(\?.*)?$/, (route) => route.fulfill({ json: inbox }));
  await page.route('**/api/github/review-settings', (route) =>
    route.fulfill({
      json: {
        reviewer: start.reviewer === false ? null : { kind: 'spark', id: 'reviewer' },
        reviewerName: start.reviewer === false ? null : 'PR Reviewer',
        autoReview: false,
        mayPost: true,
        mayApprove: false,
      },
    }),
  );
  await page.route(/\/api\/github\/reviews(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      server.posts.push(request.postDataJSON() as Json);
      const queued = review({
        id: '00000000-0000-4000-8000-000000000002',
        state: 'queued',
        body: null,
        requestedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      });
      server.reviews = [queued, ...server.reviews];
      return route.fulfill({ status: 201, json: queued });
    }
    server.listed.push(new URL(request.url()).searchParams.get('pull') ?? '');
    return route.fulfill({ json: { reviews: server.reviews } });
  });
  await page.route('**/api/github/inbox/details?*', (route) =>
    route.fulfill({
      json: {
        id: new URL(route.request().url()).searchParams.get('id'),
        body: '',
        bodyCut: false,
        files: [],
        filesTotal: 0,
      },
    }),
  );
  await page.route(/\/api\/github\/reviews\/[^/]+\/stop$/, (route) => {
    const id = route.request().url().split('/').at(-2)!;
    server.stops.push(id);
    const stopped = { ...server.reviews.find((entry) => entry.id === id)!, state: 'stopped' };
    server.reviews = server.reviews.map((entry) => (entry.id === id ? stopped : entry));
    return route.fulfill({ json: stopped });
  });
  return server;
}

async function openPane(page: Page) {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await main.locator('.gh-main').first().click();
  const pane = main.getByRole('complementary', { name: 'Retry webhook deliveries 1' });
  await expect(pane).toBeVisible();
  await expect(pane.locator('.gh-sec .skel')).toHaveCount(0);
  return { main, pane, block: pane.getByRole('region', { name: 'Review' }) };
}

async function expectAxeClean(page: Page) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await animationsSettled(page);
    const audit = await new AxeBuilder({ page }).include('.gh').analyze();
    expect({ colorScheme, violations: audit.violations }).toEqual({ colorScheme, violations: [] });
  }
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Review now asks for a review, Stop ends it and focus stays on the button', async ({
  page,
}) => {
  const server = await stubReviews(page);
  const { block } = await openPane(page);
  await expect(block).toContainText('No review yet');
  await expect.poll(() => server.listed).toContain(PULL);

  const action = block.getByRole('button', { name: 'Review now' });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => server.posts).toEqual([{ pull: PULL }]);
  const stop = block.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeFocused();
  await expect(block.getByRole('status')).toHaveText('Queued');
  await expect(block).toContainText('By Spark PR Reviewer');

  await page.keyboard.press('Enter');
  await expect.poll(() => server.stops).toEqual(['00000000-0000-4000-8000-000000000002']);
  await expect(block.getByRole('button', { name: 'Review again' })).toBeFocused();
  await expect(block.getByRole('status')).toHaveText('Stopped');
  await expectAxeClean(page);
});

test('a running review shows Reviewing and Stop, and the row says Reviewing', async ({ page }) => {
  await stubReviews(page, {
    reviews: [review({ state: 'running', body: null, finishedAt: null })],
    summary: { state: 'running', headSha: HEAD, stale: false, posted: null },
  });
  const { main, block } = await openPane(page);
  await expect(main.locator('.gh-row').first().locator('.gh-pill.review')).toHaveText('Reviewing');
  await expect(block.getByRole('status')).toHaveText('Reviewing');
  await expect(block.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(block.getByRole('button', { name: /Review (now|again)/ })).toHaveCount(0);
});

test('polling a running review keeps the pane scrolled and focus in place', async ({ page }) => {
  const server = await stubReviews(page, {
    reviews: [review({ state: 'running', body: null, finishedAt: null })],
  });
  await page.setViewportSize({ width: 1000, height: 420 });
  const { pane, block } = await openPane(page);
  const stop = block.getByRole('button', { name: 'Stop' });
  await stop.focus();
  const top = await pane.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(top).toBeGreaterThan(0);
  const seen = server.listed.length;
  await expect.poll(() => server.listed.length, { timeout: 10_000 }).toBeGreaterThan(seen);
  await animationsSettled(page);
  expect(await pane.evaluate((element) => element.scrollTop)).toBe(top);
  await expect(stop).toBeFocused();
});

test('a done review shows plain prose, posted link and the earlier-commit line', async ({
  page,
}) => {
  await stubReviews(page, {
    reviews: [
      review({
        headSha: 'f'.repeat(40),
        posted: [
          {
            kind: 'comment',
            url: 'https://github.com/acme/api/pull/1#pullrequestreview-9',
            at: new Date().toISOString(),
          },
        ],
      }),
    ],
    summary: { state: 'done', headSha: 'f'.repeat(40), stale: true, posted: 'comment' },
  });
  const { main, pane, block } = await openPane(page);
  await expect(main.locator('.gh-row').first().locator('.gh-pill.review')).toHaveText('Reviewed');
  await expect(block.getByRole('status')).toHaveText('Done');
  await expect(block).toContainText('should the last attempt log at warn');
  await expect(block).toContainText('Reviewed an earlier commit');
  const link = block.getByRole('link', { name: 'View on GitHub' });
  await expect(link).toHaveAttribute(
    'href',
    'https://github.com/acme/api/pull/1#pullrequestreview-9',
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(pane.locator('.btn.primary')).toHaveCount(1);

  await pane.getByRole('button', { name: 'Close details' }).focus();
  const order: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
  }
  expect(order).toEqual(expect.arrayContaining(['Review again', 'View on GitHub']));
  await expectAxeClean(page);
});

test('a done review renders headings, lists and folded details', async ({ page }) => {
  await stubReviews(page, {
    reviews: [
      review({
        body: DETAILED,
        posted: [{ kind: 'comment', url: null, at: new Date().toISOString() }],
      }),
    ],
  });
  const { block } = await openPane(page);
  await expect(block.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(block.getByRole('listitem')).toHaveCount(2);
  await expect(block).toContainText('Posted to GitHub');
  await expect(block.getByRole('link', { name: 'View on GitHub' })).toHaveCount(0);
  const summary = block.locator('summary', { hasText: 'Files reviewed (3)' });
  await expect(block.getByRole('table')).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(block.getByRole('table')).toBeVisible();
  await expectAxeClean(page);
});

test('a failed review shows its error, and no reviewer points to Auto-review', async ({ page }) => {
  await stubReviews(page, {
    reviews: [review({ state: 'failed', body: null, error: 'The Spark could not read the diff.' })],
    reviewer: false,
  });
  const { block } = await openPane(page);
  await expect(block.getByRole('status')).toHaveText('Failed');
  await expect(block).toContainText('The Spark could not read the diff.');
  await expect(block).toContainText('Pick a reviewer under Auto-review');
  await expect(block.getByRole('button')).toHaveCount(0);
  await expectAxeClean(page);
});

test('the review pane fits wide, medium and narrow windows', async ({ page }) => {
  await stubReviews(page, {
    reviews: [
      review({
        body: DETAILED,
        posted: [
          {
            kind: 'comment',
            url: 'https://github.com/acme/api/pull/1#r',
            at: new Date().toISOString(),
          },
        ],
      }),
    ],
  });
  await page.emulateMedia({
    colorScheme: 'dark',
    reducedMotion: SHOTS ? 'reduce' : 'no-preference',
  });
  const { main, pane, block } = await openPane(page);
  await block.locator('summary').click();
  for (const width of [1440, 1000, 720]) {
    await page.setViewportSize({ width, height: 900 });
    if (!(await pane.isVisible())) await main.locator('.gh-main').first().click();
    await expect(block.getByRole('table')).toBeVisible();
    await animationsSettled(page);
    const overflow = await page.evaluate(() => {
      const gap = (selector: string) => {
        const element = document.querySelector(selector)!;
        return element.scrollWidth - element.clientWidth;
      };
      return {
        page: gap('.gh'),
        list: gap('.gh-list'),
        pane: gap('.gh-detail'),
        review: gap('.gh-review'),
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect({ width, ...overflow }).toEqual({
      width,
      page: 0,
      list: 0,
      pane: 0,
      review: 0,
      document: 0,
    });
  }
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });

  test('review pane screenshots', async ({ page }) => {
    test.skip(!SHOTS, 'set SPARK_DESIGN_SHOTS=1 to write the design screenshots');
    await stubReviews(page, {
      reviews: [
        review({
          body: DETAILED,
          posted: [
            {
              kind: 'comment',
              url: 'https://github.com/acme/api/pull/1#r',
              at: new Date().toISOString(),
            },
          ],
        }),
      ],
      summary: { state: 'done', headSha: HEAD, stale: false, posted: 'comment' },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const { main, pane, block } = await openPane(page);
    await expect(block.getByRole('heading', { name: 'Summary' })).toBeVisible();
    for (const [name, width] of [
      ['wide', 1440],
      ['narrow', 720],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      if (!(await pane.isVisible())) await main.locator('.gh-main').first().click();
      await animationsSettled(page);
      await page.screenshot({ path: `docs/design/mocks/built/github-review-pane-${name}.png` });
    }
  });
});

test('a workflow review that posted nothing says so and names the workflow', async ({ page }) => {
  await stubReviews(page, {
    reviews: [review({ reviewer: { kind: 'workflow', id: 'gauntlet', name: 'The Gauntlet' } })],
    summary: { state: 'done', headSha: HEAD, stale: false, posted: null },
  });
  const { block } = await openPane(page);
  await expect(block).toContainText('By workflow The Gauntlet');
  await expect(block).toContainText(
    'Nothing posted to GitHub. The Gauntlet posts or approves only when its instructions say to',
  );
  await expect(block.getByRole('link', { name: 'View on GitHub' })).toHaveCount(0);
});

test('a review started in a chat says so, opens its chat and has no Stop', async ({ page }) => {
  await stubReviews(page, {
    reviews: [
      review({
        state: 'running',
        body: null,
        finishedAt: null,
        reviewer: { kind: 'workflow', id: 'gauntlet', name: 'The Gauntlet' },
        startedFrom: 'mention',
        chatId: '00000000-0000-4000-8000-0000000000c1',
      }),
    ],
    summary: { state: 'running', headSha: HEAD, stale: false, posted: null },
  });
  const { block } = await openPane(page);
  await expect(block).toContainText('By workflow The Gauntlet · Started from: From a chat');
  await expect(block.getByRole('button', { name: 'Open chat' })).toBeVisible();
  await expect(block.getByRole('button', { name: 'Stop' })).toHaveCount(0);
});

test('the pull request list resizes by drag and keys and keeps its width', async ({ page }) => {
  await stubReviews(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const { main, pane } = await openPane(page);
  const handle = main.getByRole('separator', { name: 'Resize pull request list' });
  const list = main.getByRole('region', { name: 'Pull requests' });
  const before = (await list.boundingBox())!.width;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await list.boundingBox())!.width).toBeGreaterThan(before + 100);
  const wide = (await pane.boundingBox())!;
  expect(wide.x + wide.width).toBeGreaterThan(1500);

  await handle.focus();
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '280');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '328');

  await page.reload();
  await main.locator('.gh-main').first().click();
  await expect(handle).toHaveAttribute('aria-valuenow', '328');
  await page.keyboard.press('Escape');
  await expectAxeClean(page);
});

test('a finished review copies as Markdown and goes to a chat as an attachment', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubReviews(page, { reviews: [review()] });
  const { block } = await openPane(page);
  await block.getByRole('button', { name: 'Copy review' }).click();
  await expect(block.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(
    'Review of acme/api#1 (Retry webhook deliveries 1), by Spark PR Reviewer',
  );
  expect(copied).toContain(PROSE);

  await block.getByRole('button', { name: 'Send to chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toContainText(
    'Pull request acme/api#1: https://github.com/acme/api/pull/1',
  );
  await expect(page.getByText('review-pr-1.md')).toBeVisible();
});
