import { rmSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import {
  askForPlanApproval,
  markWatchChecks,
  seedFlowChats,
  setPullChecks,
  watchPull,
} from './ticket-flow-seed.ts';
import {
  connectTickets,
  hoverOnceSettled,
  openTickets,
  resetTicketFakes,
  STUB_URL,
} from './ticket-seed.ts';
import { FAKE_GH_STATE } from './stub-config.ts';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);
const views = (page: Page) => main(page).getByRole('navigation', { name: 'Ticket views' });

const GROUPS = [
  'Needs you',
  'In progress with Spark',
  'Started',
  'Up next',
  'In review / PR open',
  'Done recently',
];

const PLAN_APPROVAL = {
  kind: 'other',
  title: 'Plan',
  plan: '# Add CSV export\n\n1. Write `src/export.ts`',
};

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ request }) => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await request.post(`${STUB_URL}/github-test/reset`);
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function seedEveryGroup(page: Page) {
  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');
  return seedFlowChats([
    { key: 'WEB-421', source: 'linear', status: 'awaiting_approval', approval: PLAN_APPROVAL },
    {
      key: 'WEB-433',
      source: 'linear',
      status: 'running',
      spark: 'Pip',
      plan: ['completed', 'completed', 'in_progress'],
    },
    { key: 'API-84', source: 'jira', status: 'succeeded' },
    {
      key: 'API-77',
      source: 'jira',
      status: 'succeeded',
      pull: { number: 341, checks: 'passing' },
    },
    {
      key: 'WEB-418',
      source: 'linear',
      status: 'succeeded',
      pull: { number: 342, checks: 'failing' },
    },
  ]);
}

test('groups tickets by where they are in your flow, with a chip and Spark progress on each row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await seedEveryGroup(page);
  await openTickets(page);

  await expect(section(page, 'Needs you').locator('li.irow')).toHaveCount(3, { timeout: 15_000 });
  const regions = main(page).locator('section[aria-label]');
  await expect(regions).toHaveText(GROUPS.map((name) => new RegExp(`^${escape(name)}`)));

  await expect(row(page, 'WEB-421')).toContainText(/In Progress.*Approve plan/);
  const reviewing = section(page, 'In review / PR open');
  await expect(reviewing.locator('li.irow')).toHaveCount(2);
  await expect(reviewing).toContainText('WEB-418');
  await expect(row(page, 'WEB-418')).toContainText(/In Review.*PR #342/);
  await expect(row(page, 'WEB-418').locator('.fchip.ci')).toHaveText('Checks failing, new');
  await expect(row(page, 'API-81').locator('.fchip.blocked')).toHaveText('Blocked');
  const spark = section(page, 'In progress with Spark');
  await expect(spark.locator('li.irow')).toHaveCount(1);
  await expect(row(page, 'WEB-433')).toContainText('2/3 · Pip working');
  await expect(row(page, 'API-84')).toContainText('Chat finished · not shipped');
  await expect(section(page, 'Started')).toContainText('API-84');
  await expect(section(page, 'Up next')).toContainText('ENG-1210');
  await expect(row(page, 'API-77').locator('.fchip.in_review')).toHaveText('Code Review');
  await expect(row(page, 'API-77')).toContainText('PR #341');
  await expect(row(page, 'API-77').locator('.fchip.ci')).toHaveText('Checks passing');
  await expect(row(page, 'ENG-1210').locator('.fchip.todo')).toHaveText('Todo');
  await expect(row(page, 'WEB-433').getByRole('img', { name: /^Assigned to / })).toBeVisible();
  const done = section(page, 'Done recently');
  await expect(done.getByRole('button', { name: /^Done recently/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await done.getByRole('button', { name: /^Done recently/ }).click();
  await expect(row(page, 'ENG-1190').locator('.fchip.done')).toHaveText('Done');

  await expect(views(page).getByRole('button')).toHaveText([
    /^Inbox\s*10$/,
    /^Needs you\s*3$/,
    /^In progress with Spark\s*1$/,
    /^Started\s*1$/,
    /^Up next\s*1$/,
    /^In review \/ PR open\s*2$/,
    /^Done recently\s*2$/,
    /^Attention rules$/,
  ]);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(main(page).locator('.tk-none')).toBeHidden();
});

test('the side column filters the list, moves with the arrow keys and remembers the view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await seedEveryGroup(page);
  await openTickets(page);
  await expect(section(page, 'Needs you').locator('li.irow')).toHaveCount(3, { timeout: 15_000 });
  await expect(main(page).locator('.tk-none')).toContainText('Select a ticket');

  const inbox = views(page).getByRole('button', { name: /^Inbox/ });
  const withSpark = views(page).getByRole('button', { name: /^In progress with Spark/ });
  await expect(inbox).toHaveAttribute('aria-pressed', 'true');
  await inbox.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(withSpark).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(withSpark).toHaveAttribute('aria-pressed', 'true');
  await expect(inbox).toHaveAttribute('aria-pressed', 'false');
  await expect(main(page).locator('li.irow')).toHaveCount(1);
  await expect(row(page, 'WEB-433')).toBeVisible();
  await page.keyboard.press('End');
  await expect(views(page).getByRole('button', { name: /^Done recently/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(inbox).toBeFocused();

  await page.reload();
  await expect(withSpark).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(main(page).locator('li.irow')).toHaveCount(1);

  await page.keyboard.press('/');
  await page.keyboard.type('upload');
  await expect(withSpark).toHaveAttribute('aria-pressed', 'false');
  await inbox.click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(section(page, 'Needs you')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(views(page).getByRole('button', { name: /^Needs you/ })).toBeVisible();
  const box = await views(page).boundingBox();
  const list = await section(page, 'Needs you').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(list!.y);
});

test('rows move with the keyboard, Enter opens one, and focus shows a preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await seedEveryGroup(page);
  await openTickets(page);
  const first = row(page, 'WEB-421').locator('.ir-main');
  await expect(first).toBeVisible({ timeout: 15_000 });

  await first.focus();
  await page.keyboard.press('ArrowDown');
  const second = main(page).locator('.ir-main').nth(1);
  await expect(second).toBeFocused();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toContainText('Status');
  await expect(second).toHaveAttribute('aria-describedby', /.+/);
  await page.keyboard.press('End');
  await expect(main(page).locator('.ir-main').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'WEB-421 details' })).toBeVisible();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  const below = await main(page).locator('li.irow').nth(1).getAttribute('data-ticket');
  await expect(
    page.getByRole('complementary', { name: `${below!.split(':')[1]} details` }),
  ).toBeVisible();

  await hoverOnceSettled(page, row(page, 'API-77'));
  const preview = page.getByRole('tooltip', { name: /^API-77/ });
  await expect(preview).toContainText('API-77 · Rate limit headers missing on 429 responses');
  await expect(preview).toContainText('#341 in acme/widgets');
});

test('a linked chat and its pull request move the ticket between groups without a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const [, running, , reviewing] = await seedEveryGroup(page);
  await openTickets(page);
  await expect(section(page, 'In progress with Spark')).toContainText('WEB-433', {
    timeout: 15_000,
  });

  await askForPlanApproval(running!);
  await expect(section(page, 'Needs you')).toContainText('WEB-433', { timeout: 15_000 });
  await expect(row(page, 'WEB-433')).toContainText('Approve plan');
  await expect(section(page, 'In progress with Spark')).toHaveCount(0);
  await expect(views(page).getByRole('button', { name: 'Needs you 4' })).toBeVisible();

  await setPullChecks(341, 'failing');
  const watch = await watchPull(reviewing!, 341);
  await markWatchChecks(watch, 'failing');
  await expect(row(page, 'API-77').locator('.fchip.ci')).toHaveText('Checks failing, new', {
    timeout: 30_000,
  });
  await expect(section(page, 'In review / PR open')).toContainText('API-77');
  await expect(views(page).getByRole('button', { name: 'Needs you 4' })).toBeVisible();
});

test('the grouped list has no serious accessibility issues in light, dark and at phone width', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await seedEveryGroup(page);
  await openTickets(page);
  await expect(row(page, 'WEB-433')).toBeVisible({ timeout: 15_000 });
  await section(page, 'Done recently')
    .getByRole('button', { name: /^Done recently/ })
    .click();

  const violations = async (label: string) => {
    const results = await new AxeBuilder({ page })
      .include('main.tk')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return results.violations.map((violation) => `${label}: ${violation.id}`);
  };
  const found = await violations('light');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  found.push(...(await violations('dark')));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row(page, 'WEB-433')).toContainText('Pip working');
  found.push(...(await violations('phone')));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const chip = await row(page, 'WEB-433').locator('.fchip').boundingBox();
  const title = await row(page, 'WEB-433').locator('.tk-title').boundingBox();
  expect(chip!.y).toBeGreaterThan(title!.y);
  expect(title!.width).toBeGreaterThan(140);
  expect(found).toEqual([]);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
