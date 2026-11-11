import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const current = (page: Page) => rail(page).locator('[aria-current="page"]');

async function positionOf(page: Page, label: string): Promise<number> {
  await expect(rail(page).getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  const labels = await rail(page).locator('.rail-btn[data-view]').allInnerTexts();
  const index = labels.findIndex((text) => text.startsWith(label));
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

test('Ctrl+Alt+digit jumps to the matching left bar item', async ({ page }) => {
  await page.goto('/');
  const tickets = await positionOf(page, 'Tickets');
  const chats = await positionOf(page, 'Chats');
  const home = await positionOf(page, 'Home');

  await page.keyboard.press(`Control+Alt+Digit${tickets}`);
  await expect(current(page)).toContainText('Tickets');
  await page.keyboard.press(`Control+Alt+Digit${chats}`);
  await expect(current(page)).toContainText('Chats');
  await page.keyboard.press(`Control+Alt+Digit${home}`);
  await expect(current(page)).toContainText('Home');
});

test('shows the chord in each button title', async ({ page }) => {
  await page.goto('/');
  const chats = rail(page).getByRole('button', { name: /^Chats/ });
  await expect(chats).toHaveAttribute('title', /^Chats · Ctrl Alt \d$/);
  await expect(chats).toHaveAttribute('aria-keyshortcuts', /^Control\+Alt\+\d$/);
});

test('works from the composer without typing into it', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.click();
  await input.pressSequentially('keep');
  const chats = await positionOf(page, 'Chats');
  const tickets = await positionOf(page, 'Tickets');

  await page.keyboard.press(`Control+Alt+Digit${chats}`);
  await expect(current(page)).toContainText('Chats');
  await expect(input).toHaveValue('keep');

  await page.keyboard.press(`Control+Alt+Digit${tickets}`);
  await expect(current(page)).toContainText('Tickets');
});

test('a digit past the last item does nothing', async ({ page }) => {
  await page.goto('/');
  const count = await rail(page).locator('.rail-btn[data-view]').count();
  expect(count).toBeLessThan(9);
  await page.keyboard.press('Control+Alt+Digit2');
  const before = await current(page).innerText();
  await page.keyboard.press('Control+Alt+Digit9');
  await expect(current(page)).toHaveText(before);
});
