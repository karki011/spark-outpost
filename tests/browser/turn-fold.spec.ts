import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { pickPermission } from './permissions-kit.ts';
import {
  allowEdit,
  chatRepo,
  keptResult,
  linkedChat,
  send,
  turnDone,
  type ChatRepo,
} from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

const fold = (page: Page) =>
  page
    .locator('.msg.ai')
    .last()
    .getByRole('button', { name: /^Worked/ });
const answer = (page: Page) =>
  page
    .locator('.msg.ai')
    .last()
    .getByText(/This reply comes from the fake provider/);
const commentary = (page: Page) =>
  page.locator('.msg.ai').last().getByText('I will read the message before I answer.');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page
      .locator('.msg.ai')
      .last()
      .screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
}

let repo: ChatRepo;

test.beforeEach(() => {
  repo = chatRepo();
});

test.afterEach(() => repo.remove());

test('a finished turn folds its steps and notes under one row and keeps the answer', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, collapseTurns: true });
  await linkedChat(page, repo);
  await send(page, 'Check the invoices #commentary #think');
  await turnDone(page);

  const toggle = fold(page);
  await expect(toggle).toHaveText(/^Worked for \d+s · searched 2 times, thought once$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  await expect(answer(page)).toBeVisible();
  await expect(commentary(page)).toBeHidden();
  await shot(page, 'turn-folded');

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(commentary(page)).toBeVisible();
  await expect(page.locator('.msg.ai').last().locator('.trows')).not.toHaveCount(0);
  await shot(page, 'turn-unfolded');

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(commentary(page)).toBeHidden();
});

test('the kept line and answered cards stay outside the fold', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, collapseTurns: true });
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  await send(page, 'Add a line to the notes #edit #commentary');
  await allowEdit(page);
  await turnDone(page);

  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(keptResult(page)).toBeVisible();
  await expect(page.getByRole('group', { name: /^Edit .+\?$/ })).toBeVisible();
});

test('turning Collapse finished turns off shows every step again', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, collapseTurns: true });
  await linkedChat(page, repo);
  await send(page, 'Check the invoices #commentary #think');
  await turnDone(page);
  await expect(fold(page)).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  const toggle = page
    .getByRole('dialog', { name: 'Chats & autonomy' })
    .getByRole('switch', { name: 'Collapse finished turns', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/setup')).json()).profile.collapseFinishedTurns,
    )
    .toBe(false);
  await page.keyboard.press('Escape');

  await expect(fold(page)).toHaveCount(0);
  await expect(commentary(page)).toBeVisible();
});
