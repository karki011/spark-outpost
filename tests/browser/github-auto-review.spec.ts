import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

type Json = Record<string, unknown>;

interface Reviewer {
  kind: 'spark' | 'workflow';
  id: string;
}

interface Settings {
  reviewer: Reviewer | null;
  reviewerName: string | null;
  autoReview: boolean;
  mayPost: boolean;
  mayApprove: boolean;
}

const OFF: Settings = {
  reviewer: null,
  reviewerName: null,
  autoReview: false,
  mayPost: false,
  mayApprove: false,
};

const FLOW = { id: 'deep-review', name: 'Deep review' };
const SHOTS = process.env.SPARK_DESIGN_SHOTS === '1';

function pull(id: string): Json {
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
    changedFiles: 2,
    projectId: null,
    conversationId: null,
    ticket: null,
    unseen: false,
    updatedSinceSeen: false,
  };
}

async function createSpark(page: Page): Promise<string> {
  const response = await page.request.post('/api/teammates', {
    data: { name: 'PR Reviewer', role: 'Reviews pull requests' },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function stubPage(page: Page, sparkId: string, start: Partial<Settings> = {}) {
  const names: Record<string, string> = {
    [`spark:${sparkId}`]: 'PR Reviewer',
    [`workflow:${FLOW.id}`]: FLOW.name,
  };
  const server = { state: { ...OFF, ...start }, puts: [] as Json[], failNext: false };
  const inbox = {
    connected: true,
    login: 'me',
    windowDays: 14,
    fetchedAt: new Date().toISOString(),
    items: ['1', '2', '3'].map(pull),
    problems: [],
  };
  await page.route(/\/api\/github\/inbox(\?.*)?$/, (route) => route.fulfill({ json: inbox }));
  await page.route(/\/api\/workflows$/, (route) =>
    route.fulfill({
      json: {
        workflows: [
          {
            ...FLOW,
            stages: [[{ stepId: 'check', sparkId }], [{ stepId: 'sum', sparkId }]],
            problems: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/api/github/review-settings', (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: server.state });
    const body = route.request().postDataJSON() as Settings;
    server.puts.push(body as unknown as Json);
    if (server.failNext) {
      server.failNext = false;
      return route.fulfill({ status: 503, json: { error: 'GitHub settings are busy.' } });
    }
    const reviewerName = body.reviewer ? names[`${body.reviewer.kind}:${body.reviewer.id}`]! : null;
    server.state = { ...body, reviewerName };
    return route.fulfill({ json: server.state });
  });
  return server;
}

async function openGithub(page: Page) {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'github'));
  await page.goto('/');
  const main = page.getByRole('main', { name: 'GitHub' });
  await expect(main.locator('.gh-main').first()).toBeVisible();
  return main;
}

const chip = (page: Page) => page.locator('.ar-chip');
const menu = (page: Page) => page.getByRole('dialog', { name: 'Auto-review' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('the chip menu picks a reviewer and turns on auto-review, posting and approving', async ({
  page,
}) => {
  const sparkId = await createSpark(page);
  const server = await stubPage(page, sparkId);
  await openGithub(page);
  await expect(chip(page)).toHaveAccessibleName('Auto-review off');

  await chip(page).focus();
  await page.keyboard.press('Enter');
  const panel = menu(page);
  await expect(panel).toBeVisible();
  const list = panel.getByRole('listbox', { name: 'Review with' });
  await expect(list.getByRole('option', { name: 'None' })).toBeFocused();
  await expect(list.getByRole('group', { name: 'Sparks' })).toContainText('PR Reviewer');
  await expect(list.getByRole('group', { name: 'Workflows' })).toContainText('Deep review2 steps');
  await expect(list.getByRole('group', { name: 'Sparks' })).toContainText('Reviews pull requests');
  await expect(
    list.getByRole('group', { name: 'Workflows' }).locator('.ar-faces svg, .ar-faces > *'),
  ).not.toHaveCount(0);

  const auto = panel.getByRole('switch', { name: 'Review automatically' });
  const post = panel.getByRole('switch', { name: 'Reviewer may post to GitHub' });
  const approve = panel.getByRole('switch', { name: 'Reviewer may approve' });
  await expect(auto).toBeDisabled();
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAccessibleDescription('Turn on Reviewer may post to GitHub first.');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(list.getByRole('option', { name: 'PR Reviewer' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(chip(page)).toHaveAccessibleName('Auto-review off · PR Reviewer');
  await auto.click();
  await expect(chip(page)).toHaveAccessibleName('Auto-review on · PR Reviewer');
  await expect(chip(page)).toContainText('Auto-review on · PR Reviewer');
  await post.click();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(approve).toHaveAttribute('aria-checked', 'true');

  const reviewer = { kind: 'spark', id: sparkId };
  await expect
    .poll(() => server.puts)
    .toEqual([
      { reviewer, autoReview: false, mayPost: false, mayApprove: false },
      { reviewer, autoReview: true, mayPost: false, mayApprove: false },
      { reviewer, autoReview: true, mayPost: true, mayApprove: false },
      { reviewer, autoReview: true, mayPost: true, mayApprove: true },
    ]);

  await post.click();
  await expect(approve).toHaveAttribute('aria-checked', 'false');
  await expect(approve).toBeDisabled();
  await expect
    .poll(() => server.puts.at(-1))
    .toEqual({ reviewer, autoReview: true, mayPost: false, mayApprove: false });

  await list.getByRole('option', { name: 'None' }).click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await expect
    .poll(() => server.puts.at(-1))
    .toEqual({ reviewer: null, autoReview: false, mayPost: false, mayApprove: false });
  await expect(chip(page)).toHaveAccessibleName('Auto-review off');

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(chip(page)).toBeFocused();
});

test('a failed save rolls the switch back and says why', async ({ page }) => {
  const sparkId = await createSpark(page);
  const server = await stubPage(page, sparkId, {
    reviewer: { kind: 'spark', id: sparkId },
    reviewerName: 'PR Reviewer',
  });
  await openGithub(page);
  await chip(page).click();
  const post = menu(page).getByRole('switch', { name: 'Reviewer may post to GitHub' });
  server.failNext = true;
  await post.click();
  await expect(menu(page).getByRole('alert')).toHaveText(
    'Couldn’t save: GitHub settings are busy.',
  );
  await expect(post).toHaveAttribute('aria-checked', 'false');
  await expect(chip(page)).toHaveAccessibleName('Auto-review off · PR Reviewer');

  await post.click();
  await expect(post).toHaveAttribute('aria-checked', 'true');
  await expect(menu(page).getByRole('alert')).toHaveCount(0);
});

test('Settings → GitHub shows the same values and changes the chip', async ({ page }) => {
  const sparkId = await createSpark(page);
  await stubPage(page, sparkId, {
    reviewer: { kind: 'workflow', id: FLOW.id },
    reviewerName: FLOW.name,
    autoReview: true,
  });
  await openGithub(page);
  await expect(chip(page)).toHaveAccessibleName('Auto-review on · Deep review');
  await chip(page).click();
  await menu(page).getByRole('button', { name: 'GitHub settings…' }).click();
  await expect(menu(page)).toHaveCount(0);

  const settings = page.getByRole('dialog', { name: 'GitHub' });
  await expect(settings.getByRole('radio', { name: 'Last 14 days' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    settings.getByRole('listbox', { name: 'Review with' }).getByRole('option', {
      name: 'Deep review',
    }),
  ).toHaveAttribute('aria-selected', 'true');
  const auto = settings.getByRole('switch', { name: 'Review automatically' });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('switch', { name: 'Follow up on pull requests' })).toBeVisible();

  if (SHOTS) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished),
      ),
    );
    await page.screenshot({ path: 'docs/design/mocks/built/github-settings-section.png' });
  }
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(chip(page)).toHaveAccessibleName('Auto-review off · Deep review');
});

test('search finds auto-review in Settings → GitHub', async ({ page }) => {
  const sparkId = await createSpark(page);
  await stubPage(page, sparkId);
  await openGithub(page);
  await chip(page).click();
  await menu(page).getByRole('button', { name: 'GitHub settings…' }).click();
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('auto-review');
  const option = page
    .getByRole('listbox', { name: 'Matching settings' })
    .getByRole('option', { name: /^Review automatically/ });
  await expect(option).toContainText('Work · GitHub');
  await search.press('Enter');
  const settings = page.getByRole('dialog', { name: 'GitHub' });
  await expect(settings.locator('.set-row[data-found]')).toContainText('Review automatically');
});

test('the chip and its menu fit wide, medium, narrow and phone widths', async ({ page }) => {
  const sparkId = await createSpark(page);
  await stubPage(page, sparkId, {
    reviewer: { kind: 'spark', id: sparkId },
    reviewerName: 'PR Reviewer',
    autoReview: true,
  });
  if (SHOTS) await page.emulateMedia({ reducedMotion: 'reduce' });
  const main = await openGithub(page);
  for (const width of [1440, 1000, 720, 520]) {
    await page.setViewportSize({ width, height: 900 });
    await chip(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName('Auto-review on · PR Reviewer');
    await expect(main.locator('.ar-chip-name')).toBeVisible({ visible: width > 720 });
    await expect(main.locator('.ar-chip-word')).toBeVisible({ visible: width > 520 });
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => ({
      page: document.querySelector('.gh')!.scrollWidth - document.querySelector('.gh')!.clientWidth,
      menu:
        document.querySelector('.ar-pop')!.scrollWidth -
        document.querySelector('.ar-pop')!.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect({ width, ...overflow }).toEqual({ width, page: 0, menu: 0, document: 0 });
    if (SHOTS && width === 1440) {
      await page.screenshot({ path: 'docs/design/mocks/built/github-auto-review-menu.png' });
    }
    if (SHOTS && width === 520) {
      await page.screenshot({ path: 'docs/design/mocks/built/github-auto-review-narrow.png' });
    }
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  }
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the chip menu passes axe in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const sparkId = await createSpark(page);
    await stubPage(page, sparkId, {
      reviewer: { kind: 'spark', id: sparkId },
      reviewerName: 'PR Reviewer',
      autoReview: true,
    });
    await openGithub(page);
    await chip(page).click();
    await expect(menu(page)).toBeVisible();
    const audit = await new AxeBuilder({ page }).include('.gh').analyze();
    expect(audit.violations).toEqual([]);
  });
}
