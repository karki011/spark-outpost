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

const working = (page: Page) => page.locator('.ai-avatar.working');
const done = (page: Page) => page.locator('.mood', { hasText: 'done' });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test("the ring shows the model's window during a turn and after it", async ({ page }) => {
  await send(page, 'Plan the rollout #ctx13 #window1m #midturn');
  const ring = page.getByRole('button', {
    name: 'Context window: 13% used, 130K of 1M tokens',
  });
  await expect(ring).toHaveText('13%');
  await expect(working(page)).toBeVisible();

  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await expect(ring).toHaveText('13%');
});

test('the ring hides its percentage while the window is unknown', async ({ page }) => {
  await send(page, 'Plan the rollout #ctx40 #midturn');
  const unknown = page.getByRole('button', { name: 'Context window: no usage reported yet' });
  await expect(page.getByText(/This reply comes from the fake provider/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(unknown).toHaveText('');
  await expect(working(page)).toBeVisible();

  await expect(done(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Context window: 40% used/ })).toHaveText('40%');
});
