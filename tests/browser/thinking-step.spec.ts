import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_THOUGHT } from '../../apps/server/src/providers/fake.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.SPARK_SHOTS;
const THOUGHT = FAKE_THOUGHT.join('');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function ask(page: Page, message: string) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(message);
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
}

const thinking = (page: Page) => page.getByRole('button', { name: /^Thought( for \d+s)?$/ });
const thought = (page: Page) => page.getByRole('group', { name: 'Thinking' });

test('the thinking text is closed until asked for, opens from the keyboard, and survives a reload', async ({
  page,
}) => {
  await ask(page, 'Explain yourself #think');
  await expect(thinking(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(thought(page)).toHaveCount(0);
  await expect(page.locator('.trow', { hasText: 'Writing a reply' })).toBeVisible();
  await expect(page.locator('button.trow', { hasText: 'Writing a reply' })).toHaveCount(0);

  const top = await page.locator('.thread').evaluate((thread) => thread.scrollTop);
  await thinking(page).focus();
  await page.keyboard.press('Enter');
  await expect(thinking(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(thought(page)).toHaveText(THOUGHT);
  await expect(thinking(page)).toBeFocused();
  expect(await page.locator('.thread').evaluate((thread) => thread.scrollTop)).toBe(top);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((skin) => {
      document.documentElement.dataset.skin = skin === 'light' ? 'light' : 'graphite';
    }, scheme);
    const axe = await new AxeBuilder({ page }).include('.trows').analyze();
    expect(axe.violations, scheme).toEqual([]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `thinking-open-${scheme}.png`) });
  }

  await page.keyboard.press('Space');
  await expect(thought(page)).toHaveCount(0);
  await expect(thinking(page)).toBeFocused();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'thinking-closed-dark.png') });

  await page.reload();
  await thinking(page).click();
  await expect(thought(page)).toHaveText(THOUGHT);
});

test('a run without thinking shows its steps as plain rows', async ({ page }) => {
  await ask(page, 'Just answer');
  await expect(page.locator('.msg.ai .trow', { hasText: 'Writing a reply' })).toBeVisible();
  await expect(page.locator('.msg.ai .trows').getByRole('button')).toHaveCount(0);
});
