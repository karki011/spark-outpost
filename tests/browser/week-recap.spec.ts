import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const card = (page: Page) => page.getByRole('region', { name: 'Week recap' });

async function recapDueNow() {
  const db = openTestDb();
  try {
    const today = ((new Date().getDay() + 6) % 7) + 1;
    await db.query(
      `UPDATE profiles SET week_recap = true, week_recap_day = $1, week_recap_time = '00:00'`,
      [today],
    );
  } finally {
    await db.end();
  }
}

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
}

test('Home writes a week recap in two voices, refines it on request and copies it', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Download prompt', run: { status: 'succeeded' } },
    { title: 'Calendar clash nudges', run: { status: 'succeeded' } },
  ]);
  await recapDueNow();
  await openHome(page);

  const recap = card(page);
  await expect(recap.getByText(/See what you got done this week/)).toBeVisible();
  await recap.getByRole('button', { name: 'Write it' }).click();

  await expect(recap.getByText(/· 2 chats$/)).toBeVisible({ timeout: 15_000 });
  const done = recap.getByRole('region', { name: /Done this week/ });
  await expect(done.getByRole('listitem')).toHaveCount(1);
  await done.getByRole('button', { name: '+ 1 more · Show all' }).click();
  await expect(done.getByRole('listitem')).toHaveCount(2);
  await expect(done).toContainText('I finished Download prompt.');
  await expect(recap.getByRole('region', { name: /In progress/ })).toContainText(
    'Nothing in progress.',
  );
  await expect(recap.getByRole('region', { name: /Waiting on you/ })).toBeVisible();
  await expect(recap).not.toContainText('#9999');

  await recap.getByRole('radio', { name: 'For my manager' }).click();
  await expect(recap.getByRole('region', { name: /Waiting on you/ })).toHaveCount(0);
  const box = recap.getByRole('textbox', { name: 'Message for your manager' });
  await expect(box).toHaveValue(/^\*\*Done this week:\*\* Finished /);

  await box.fill('**Done this week:** Shipped downloads.');
  await recap.getByRole('textbox', { name: 'Ask Spark to change the message' }).fill('shorter');
  await recap.getByRole('button', { name: 'Refine' }).click();
  await expect(box).toHaveValue('**Done this week:** Shipped downloads.\n\n_Refined: shorter_', {
    timeout: 15_000,
  });
  await recap.getByRole('button', { name: 'Undo' }).click();
  await expect(box).toHaveValue('**Done this week:** Shipped downloads.');

  await recap.getByRole('button', { name: 'Copy as plain text' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Done this week: Shipped downloads.',
  );
  await expect(recap.locator('.recap-meta')).toHaveText(/\$0\.0\d+$/);
});

test('the recap waits for its day, and This week so far writes one early', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Download prompt', run: { status: 'succeeded' } }]);
  const db = openTestDb();
  try {
    const today = ((new Date().getDay() + 6) % 7) + 1;
    await db.query(
      `UPDATE profiles SET week_recap = true, week_recap_day = $1, week_recap_time = '23:59'`,
      [today],
    );
  } finally {
    await db.end();
  }
  await openHome(page);
  const recap = card(page);
  await expect(recap.getByText(/Your recap comes on the day you chose/)).toBeVisible();
  await recap.getByRole('button', { name: 'This week so far' }).click();
  await expect(recap.getByRole('region', { name: /Done this week/ })).toContainText(
    'I finished Download prompt.',
    { timeout: 15_000 },
  );
});
