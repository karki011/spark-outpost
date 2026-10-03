import { expect, test } from '@playwright/test';
import { resetCrew, send } from './crew-engine.ts';
import { openChats } from './navigation.ts';
import { connectTickets, resetTicketFakes } from './ticket-seed.ts';

test.beforeEach(async ({ page }) => {
  await resetCrew();
  await resetTicketFakes();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('an agent asks to create a ticket and the user edits and confirms it on a card', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await connectTickets(page, ['linear']);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();

  await send(
    page,
    '#build #spark spark_create_ticket {"project":"ENG","title":"Crash on save","priority":"high"}',
  );

  const card = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('Linear · ENG');
  await expect(card).toContainText('Nothing happens until you confirm');
  await expect(card.getByRole('button', { name: 'Priority' })).toHaveText('High');
  await card.getByLabel('Title').fill('Crash when saving drafts');
  await card.getByRole('button', { name: 'Create ticket' }).click();

  await expect(page.getByText(/"outcome":"waiting_for_user"/)).toBeVisible({ timeout: 30_000 });
  const resolved = page.getByRole('group', { name: /Create this ticket\?/ });
  await expect(resolved).toContainText(/Created ENG-\d+\./, { timeout: 30_000 });
  await expect(resolved.getByRole('link', { name: /Open: Created ENG-\d+/ })).toBeVisible();
});
