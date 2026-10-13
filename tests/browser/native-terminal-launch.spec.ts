import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { pickTerminalAgent } from './native-terminal-support.ts';
import { openChats } from './navigation.ts';
import { connectTickets, openTickets, resetTicketFakes } from './ticket-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test('terminal launch selection preserves chat and lets the user pick a native agent @packaged', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const choice = page.getByRole('radiogroup', { name: 'Session type' });
  await expect(choice.getByRole('radio', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await choice.getByRole('radio', { name: 'Terminal' }).click();
  await expect(page.getByRole('heading', { name: 'Work in your terminal' })).toBeVisible();
  const composer = page.locator('.composer-wrap');
  await expect(composer.getByRole('radiogroup', { name: 'Session type' })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Choose project', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: /^Permissions: / })).toBeVisible();
  await expect(composer).toContainText('Terminal sessions don’t open pull requests automatically');
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toBeDisabled();
  await pickTerminalAgent(page, 'Codex');
  await expect(
    page.getByText('The real Codex interface, with Spark tools and your project context.'),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect this project.');
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toBeEnabled();
  await choice.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start terminal', exact: true })).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toBeVisible();
});

test('ticket launch keeps Terminal separate from Plan first and Build @packaged', async ({
  page,
}) => {
  await resetTicketFakes();
  await connectTickets(page, ['linear']);
  await openTickets(page);
  await page.getByRole('main', { name: 'Tickets' }).locator('li[data-ticket$=":ENG-1210"]').hover();
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on ENG-1210' });
  await dialog
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await dialog.getByRole('button', { name: 'Terminal agent', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Codex', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Plan first', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await dialog.getByRole('radio', { name: 'Build', exact: true }).click();
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/tickets/linear/ENG-1210/start', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Test launch stopped before executing an agent.' }),
    });
  });
  await dialog.getByRole('button', { name: 'Start building', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Test launch stopped before executing an agent.',
  );
  expect(submitted).toMatchObject({
    sessionType: 'terminal',
    terminalProvider: 'codex',
    mode: 'build',
    moveToInProgress: true,
  });
});

test('failed terminal creation unlocks session and agent choices @packaged', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const sessions = page.getByRole('radiogroup', { name: 'Session type' });
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect the project.');
  await page.route('**/api/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Creation temporarily unavailable.' }),
    });
  });
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Creation temporarily unavailable.' }),
  ).toBeVisible();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await pickTerminalAgent(page, 'Codex');
  await sessions.getByRole('radio', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.composer textarea')).toBeVisible();
});

test('a failed first terminal launch unlocks the choices and leaves no dead session @packaged', async ({
  page,
}) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const sessions = page.getByRole('radiogroup', { name: 'Session type' });
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  const prompt = page.getByRole('textbox', { name: 'What would you like to work on?' });
  await prompt.fill('Inspect the project.');
  await page.route(/\/api\/conversations\/[^/]+\/terminal$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Claude Code is not installed.' }),
    });
  });
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Claude Code is not installed.' }),
  ).toBeVisible();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await page.reload();
  await expect(sessions.getByRole('radio', { name: 'Chat', exact: true })).toBeEnabled();
  await sessions.getByRole('radio', { name: 'Terminal' }).click();
  await expect(prompt).toBeVisible();
});
