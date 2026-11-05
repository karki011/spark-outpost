import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

async function send(page: Page, text: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const working = (page: Page) => page.locator('.turn-working');
const done = (page: Page) => page.locator('.mood', { hasText: 'done' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test("the ring shows the model's window during a turn and after it", async ({ page }) => {
  await send(page, 'Plan the rollout #ctx62 #window1m #midturn');
  const ring = page.getByRole('button', {
    name: 'Context window: 62% used, 620K of 1M tokens',
  });
  await expect(ring).toHaveText('62% context', { timeout: 20_000 });
  await expect(working(page)).toBeVisible();

  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await expect(ring).toHaveText('62% context');
});

test('the ring stays out of the way until the window is known and past half', async ({ page }) => {
  await send(page, 'Plan the rollout #ctx70 #midturn');
  await expect(page.getByText(/This reply comes from the fake provider/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /^Context window/ })).toHaveCount(0);
  await expect(working(page)).toBeVisible();

  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Context window: 70% used/ })).toHaveText(
    '70% context',
  );
});
