import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  NAME,
  TURN_TIMEOUT,
  asPairedPhone,
  cardOf,
  inBothThemes,
  openOutpost,
  openThread,
  outpostPage,
  post,
  say,
  seeded,
  sheet,
  stateOf,
  threadPane,
} from './outposts-kit.ts';
import { PHONE, expectNoSidewaysScroll } from './responsive-kit.ts';

const overview = (page: Page) => page.getByRole('complementary', { name: 'Overview' });
const INSTRUCTIONS_URL = /\/api\/outposts\/[^/]+\/instructions$/;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('.main.op')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function expectTopmost(menu: Locator): Promise<void> {
  await expect(menu).toBeVisible();
  const covered = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inset = 2;
    const corners = [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
    ];
    const inWindow =
      box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    const hidden = corners.filter(([x, y]) => !element.contains(document.elementFromPoint(x!, y!)));
    return { inWindow, hidden: hidden.length };
  });
  expect(covered).toEqual({ inWindow: true, hidden: 0 });
}

test('Overview groups the requests by state and names what waits on you', async ({ page }) => {
  await seeded(page);
  const main = await openOutpost(page);
  await say(page, '@api Deploy the orders service\n\nNeeds you: which region?\n\nThanks');
  await say(page, '@fe List the page sections');
  await expect(stateOf(post(page, 'Deploy the orders service'))).toHaveText('Waiting on you', {
    timeout: TURN_TIMEOUT,
  });
  await expect(stateOf(post(page, 'List the page sections'))).toHaveText('Idle', {
    timeout: TURN_TIMEOUT,
  });

  const groups = overview(page).getByRole('heading', { level: 3 });
  await expect(groups).toHaveText(['Waiting on you1', 'Idle1']);
  await expect(overview(page).getByRole('list').first()).toContainText('Deploy the orders service');
  const toggle = main.getByRole('button', { name: /^Hide Overview\. 1 thread waiting on you$/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await inBothThemes(page, 'overview', async () => {
    await expectAccessible(page);
  });

  await toggle.click();
  await expect(overview(page)).toBeHidden();
  const title = main.getByRole('button', { name: NAME, exact: true });
  await title.click();
  const menu = page.getByRole('menu', { name: NAME });
  await expectTopmost(menu);
  const [titleBox, menuBox] = await Promise.all([title.boundingBox(), menu.boundingBox()]);
  expect(Math.abs((menuBox?.x ?? 0) - (titleBox?.x ?? 0))).toBeLessThanOrEqual(1);
  await page.getByRole('menuitemcheckbox', { name: 'Show Overview' }).click();
  await expect(overview(page)).toBeVisible();
});

test('a thread opens beside the conversation, steers its chat as you, and goes back on Escape', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api List the order fields');
  const request = post(page, 'List the order fields');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });

  await openThread(request, 'api');
  const pane = threadPane(page, 'api');
  await expect(pane.getByRole('button', { name: 'Back to Overview' })).toBeFocused();
  await expect(pane).toContainText('This reply comes from the fake provider');
  await expect(cardOf(request)).toHaveClass(/\bselected\b/);
  await expect(pane.getByText('Sends to @api as you, as if typed in its chat.')).toBeVisible();

  const steer = pane.getByRole('textbox', { name: 'Message @api' });
  await steer.fill('Also say which fields are optional.');
  await steer.press('Enter');
  await expect(
    pane.locator('.msg.me .bubble', { hasText: 'Also say which fields are optional.' }),
  ).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(post(page, 'Also say which fields are optional.')).toHaveCount(0);
  await expectAccessible(page);

  await steer.press('Escape');
  await expect(pane).toBeHidden();
  await expect(overview(page).getByRole('button', { name: /List the order fields/ })).toBeFocused();
});

test('instructions are saved from the title menu and are read-only on a paired device', async ({
  page,
}) => {
  await seeded(page);
  const main = await openOutpost(page);
  await main.getByRole('button', { name: NAME, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Instructions…' }).click();
  const dialog = sheet(page, 'Instructions');
  await expect(dialog).toContainText('They grant no permission');
  const saved = page.waitForResponse(
    (response) => INSTRUCTIONS_URL.test(response.url()) && response.request().method() === 'PUT',
  );
  await dialog.getByRole('textbox').fill('Work on spark/* branches from main.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await expect(main.getByRole('button', { name: NAME, exact: true })).toBeFocused();

  await asPairedPhone(page);
  await page.reload();
  await openOutpost(page);
  await outpostPage(page, NAME).getByRole('button', { name: NAME, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Instructions…' }).click();
  const readOnly = sheet(page, 'Instructions');
  await expect(readOnly.getByRole('textbox')).toHaveValue('Work on spark/* branches from main.');
  await expect(readOnly.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(readOnly.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

test('on a phone the conversation and Overview are one segmented control, and a thread fills the screen', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api List the order fields');
  await expect(stateOf(post(page, 'List the order fields'))).toHaveText('Idle', {
    timeout: TURN_TIMEOUT,
  });
  await page.setViewportSize(PHONE);
  const views = page.getByRole('radiogroup', { name: 'Outpost view' });
  await expect(views.getByRole('radio', { name: 'Conversation' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(overview(page)).toBeHidden();
  await views.getByRole('radio', { name: 'Overview' }).click();
  await expect(overview(page)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Outpost thread' })).toBeHidden();
  await expect(overview(page).getByRole('radiogroup')).toHaveCount(0);
  await expect(overview(page).getByRole('heading', { level: 2 })).toHaveText([
    'Threads',
    'Library',
    'Pull requests',
  ]);
  await expectNoSidewaysScroll(page);

  await overview(page)
    .getByRole('button', { name: /List the order fields/ })
    .click();
  const pane = threadPane(page, 'api');
  await expect(pane).toBeVisible();
  await expect(views).toBeHidden();
  await expectNoSidewaysScroll(page);
  await pane.getByRole('button', { name: 'Back to Overview' }).click();
  await expect(overview(page)).toBeVisible();

  await outpostPage(page, NAME).getByRole('button', { name: NAME, exact: true }).click();
  await expectTopmost(page.getByRole('menu', { name: NAME }));
  await page.keyboard.press('Escape');
});
