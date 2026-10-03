import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const PR_TITLE = 'spark-outpost/demo#42';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function sendPlannedTask(page: Page, content = 'Fix the date divider #plan') {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(content);
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });
  const card = page.locator('.taskc');
  await expect(card).toContainText('Task 7/7');
  return card;
}

test('a planned run shows a task card and the work panel with plan history and a PR link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1400, height: 900 });
  const card = await sendPlannedTask(page);
  await expect(card).toContainText('Task 7/7 · Done');
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(32);

  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fix the date divider #plan' })).toBeVisible();
  await expect(panel.getByText('All done.')).toBeVisible();
  const done = panel.getByRole('list', { name: 'Done' });
  await expect(done.getByRole('button', { name: /Look through the code/ })).toBeVisible();
  await expect(done.getByRole('button', { name: `Done Opened ${PR_TITLE}` })).toBeVisible();
  await panel.getByRole('button', { name: 'Hide 7 done' }).click();
  await expect(done).toHaveCount(0);
  await page.reload();
  await expect(panel.getByRole('button', { name: 'Show 7 done' })).toBeVisible();
  await panel.getByRole('button', { name: 'Show 7 done' }).click();
  await expect(done).toBeVisible();

  await panel.getByRole('tab', { name: 'Plan' }).click();
  await expect(panel.locator('.vbadge')).toHaveText('v1');
  await expect(panel.getByText('used by Claude · 1 turn')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^History ·/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Copy as Markdown' }).click();
  await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# Plan v1');

  await panel.getByRole('tab', { name: 'Links' }).click();
  const pr = panel.getByRole('link', { name: new RegExp(PR_TITLE) });
  await expect(pr).toHaveAttribute('href', 'https://github.com/spark-outpost/demo/pull/42');
  await panel.getByRole('button', { name: 'Add link' }).click();
  await panel.getByRole('textbox', { name: 'Link URL' }).fill('https://github.com/acme/web/pull/7');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('link', { name: /acme\/web#7/ })).toContainText('Added by you');

  const toggle = page.getByRole('button', { name: 'Hide work panel' }).first();
  await toggle.click();
  await expect(panel).toBeHidden();
  await card.click();
  await expect(panel).toBeVisible();

  await page.reload();
  await expect(page.locator('.taskc')).toContainText('Task 8/8');
  await expect(page.getByRole('complementary', { name: 'Work panel' })).toBeVisible();
});

test('a chit-chat reply has no task card and a follow-up joins the open task', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Just saying hello');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.taskc')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show work panel' })).toHaveCount(0);

  await input.fill('Now fix it #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task 7/7', { timeout: 20_000 });
  await input.fill('Thanks, and one more thing');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task 8/8', { timeout: 20_000 });
  await expect(page.locator('.taskc')).toHaveCount(1);
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Cost' }).click();
  const costRows = panel.getByRole('list', { name: 'Cost by agent' }).getByRole('listitem');
  await expect(costRows).toHaveCount(1);
  await expect(costRows).toContainText('2 turns');
});

test('hovering the task card, work rows and sidebar rows does not move anything', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const card = await sendPlannedTask(page);
  const boxes = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((root) =>
        [root, ...root.querySelectorAll(':scope > *, .stack > span, .ti-av, .tt')].map((node) => {
          const box = node.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height].map(Math.round).join(',');
        }),
      );
  const steady = async (selector: string) => {
    await page.mouse.move(1, 1);
    const before = await boxes(selector);
    await page.locator(selector).first().hover();
    expect(await boxes(selector)).toEqual(before);
  };

  await expect(card).toBeVisible();
  await steady('.taskc');
  await steady('.titem .ti-row');
  await steady('nav[aria-label="Chats"] .row');
});

test('on a phone the work panel opens as a bottom sheet from the task card', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const card = await sendPlannedTask(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel).toBeHidden();

  await card.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Fix the date divider #plan' })).toBeFocused();
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? [box.y > 80, Math.round(box.y + box.height)] : null;
    })
    .toEqual([true, 800]);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
