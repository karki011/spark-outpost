import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('copies a reply and a message and shows when each was sent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Ship **it**\n> carefully');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });

  const reply = page.locator('.msg.ai').getByRole('group', { name: 'Message actions' });
  await expect(reply).toBeVisible();
  const replyTime = reply.locator('time');
  await expect(replyTime).toHaveText('just now');
  await expect(replyTime).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  await expect(replyTime).toHaveAttribute('title', /\d{4}/);
  await reply.getByRole('button', { name: 'Copy reply' }).click();
  await expect(reply.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /You wrote: "Ship \*\*it\*\*\n> carefully"$/,
  );

  const mine = page.locator('.msg.me');
  const actions = mine.getByRole('group', { name: 'Message actions' });
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('opacity', '0');
  await mine.locator('.bubble').hover();
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(actions.locator('time')).toHaveText('just now');
  await actions.getByRole('button', { name: 'Copy message' }).click();
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Ship **it**\n> carefully',
  );

  await actions.locator('.msg-act').blur();
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('opacity', '0');
  await actions.locator('.msg-act').focus();
  await expect(actions).toHaveCSS('opacity', '1');
});
