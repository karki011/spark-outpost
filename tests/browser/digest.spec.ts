import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';

const digest = (page: Page) => page.getByRole('region', { name: 'Digest' });

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
}

test('Home writes a digest on open and Continue prefills the chat without sending', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [failed, explored] = await seedChats([
    { title: 'Mock fetch retries', run: { status: 'failed', error: 'Claude is rate limited.' } },
    { title: 'Explore invalid dates', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(failed!, { provider: 'claude' });
  await decorateLatestRun(explored!, { provider: 'claude', costUsd: 0.84 });
  await openHome(page);

  const card = digest(page);
  await expect(card.locator('.dg-lines li')).toHaveCount(2, { timeout: 15_000 });
  await expect(card).toContainText(/Generated .* · \$0\.004/);
  await expect(card.locator('.dg-headline')).toHaveText(
    '1 chat finished, 1 chat failed or stalled, $0.84 spent.',
  );
  const chips = card.locator('.dg-chip');
  await expect(chips).toHaveCount(3);
  await expect(chips).toHaveText(['1 done', '1 stalled', '$0.84']);
  await expect(card.getByRole('button', { name: /^Today you worked on / })).toBeVisible();
  await expect(card.getByText('This line points at a chat that does not exist.')).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'This line points at a chat that does not exist.' }),
  ).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Refresh' })).toBeDisabled();

  const detailsToggle = card.getByRole('button', { name: 'Hide details' });
  await expect(detailsToggle).toHaveAttribute('aria-expanded', 'true');

  const next = card.getByRole('list', { name: 'Pick up where you left off' });
  await expect(next.getByRole('listitem')).toHaveCount(1);
  await expect(next).toContainText('Unfinished: last run failed.');
  await next.getByRole('button', { name: 'Continue Mock fetch retries' }).click();

  await expect(page.locator('.chat-title')).toHaveText('Mock fetch retries');
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toHaveValue(
    "Let's continue Mock fetch retries: pick up the open step and finish it.",
  );
  await expect(input).toBeFocused();
  await expect(page.locator('.bubble')).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator('.bubble')).toHaveCount(1);

  await openHome(page);
  await expect(card.locator('.dg-lines li')).toHaveCount(2);
  await card.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('dialog', { name: 'Audit this chat' })).toBeVisible();
});

test('the digest details collapse choice survives a reload', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [explored] = await seedChats([
    { title: 'Explore invalid dates', run: { status: 'succeeded' } },
  ]);
  await decorateLatestRun(explored!, { provider: 'claude' });
  await openHome(page);

  const card = digest(page);
  await expect(card.locator('.dg-lines li')).toHaveCount(2, { timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await card.getByRole('button', { name: 'Hide details' }).click();
  await expect(card.locator('.dg-lines')).toHaveCount(0);
  const showButton = card.getByRole('button', { name: 'Show details' });
  await expect(showButton).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.dg-headline')).toBeVisible();
  await expect(card.locator('.dg-chip')).toHaveCount(1);

  await openHome(page);
  await expect(card.getByRole('button', { name: 'Show details' })).toBeVisible();
  await expect(card.locator('.dg-lines')).toHaveCount(0);

  await card.getByRole('button', { name: 'Show details' }).click();
  await expect(card.locator('.dg-lines li')).toHaveCount(2);
});

test('a failed digest shows a quiet error and never blocks Home', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([
    { title: 'Break the build #fail', run: { status: 'failed', error: 'Tests failed.' } },
  ]);
  await decorateLatestRun(chat!, { provider: 'claude' });
  await openHome(page);

  const card = digest(page);
  await expect(card.locator('.dg-error')).toContainText('#fail', { timeout: 15_000 });
  await expect(card.locator('.dg-error')).toContainText(/You can refresh in \d+ min/);
  await expect(page.getByRole('region', { name: 'Needs you' })).toContainText(
    'Break the build #fail',
  );
});
