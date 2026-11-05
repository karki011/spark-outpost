import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { decorateLatestRun } from './home-seed.ts';
import { seedChats } from './sidebar-seed.ts';

const today = (page: Page) => page.getByRole('region', { name: /^What needs you today/ });
const brief = (page: Page) => today(page).locator('.hpanel.dg');

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
}

test('Home writes a brief on open and Continue prefills the chat without sending', async ({
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

  const panel = brief(page);
  await expect(panel.locator('.dg-headline')).toHaveText(
    '1 chat finished, 1 chat failed or stalled, $0.84 spent.',
    { timeout: 15_000 },
  );
  await expect(panel.locator('.dg-meta')).toHaveText(/^Generated .* · \$0\.004/);
  await expect(panel.locator('.dg-chip')).toHaveCount(0);
  await expect(today(page).getByRole('button', { name: 'Refresh' })).toBeDisabled();

  const away = panel.getByRole('button', { name: 'Show what happened since you were away (2)' });
  await expect(away).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.dg-lines')).toBeHidden();
  await away.click();
  await expect(panel.getByRole('button', { name: /^Today you worked on / })).toBeVisible();
  await expect(panel.getByText('This line points at a chat that does not exist.')).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'This line points at a chat that does not exist.' }),
  ).toHaveCount(0);

  const next = panel.getByRole('list', { name: 'Do these first' });
  await expect(next.getByRole('listitem')).toHaveCount(1);
  await expect(next).toContainText('Mock fetch retries');
  await expect(next).toContainText('Unfinished: last run failed.');
  await expect(page.getByRole('list', { name: 'Needs you' })).toContainText('Mock fetch retries');
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
  await expect(panel.locator('.dg-headline')).toBeVisible();
  await panel.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('dialog', { name: 'Audit this chat' })).toBeVisible();
});

test('the "since you were away" choice survives a reload', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [failed] = await seedChats([
    { title: 'Explore invalid dates', run: { status: 'failed', error: 'Stopped.' } },
  ]);
  await decorateLatestRun(failed!, { provider: 'claude' });
  await openHome(page);

  const panel = brief(page);
  const show = panel.getByRole('button', { name: /^Show what happened since you were away/ });
  await show.click({ timeout: 15_000 });
  const hide = panel.getByRole('button', { name: /^Hide what happened/ });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  const controlled = await hide.getAttribute('aria-controls');
  await expect(page.locator(`[id="${controlled}"] li`)).toHaveCount(2);

  await openHome(page);
  await expect(panel.locator('.dg-lines li')).toHaveCount(2);
  await panel.getByRole('button', { name: /^Hide what happened/ }).click();
  await expect(panel.locator('.dg-lines')).toBeHidden();
  await openHome(page);
  await expect(
    panel.getByRole('button', { name: /^Show what happened since you were away/ }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.dg-lines')).toBeHidden();
});

test('a failed brief keeps the list complete and never blocks Home', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([
    { title: 'Break the build #fail', run: { status: 'failed', error: 'Tests failed.' } },
  ]);
  await decorateLatestRun(chat!, { provider: 'claude' });
  await openHome(page);

  const error = brief(page).locator('.dg-error');
  await expect(error).toContainText('#fail', { timeout: 15_000 });
  await expect(error).toContainText('The list below is complete; only the summary is missing.');
  await expect(error).toContainText(/You can refresh in \d+ min/);
  await expect(page.getByRole('list', { name: 'Needs you' })).toContainText(
    'Break the build #fail',
  );
});

test('with the brief off Home says so, sorts by rules and turns it back on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([
    { title: 'Mock fetch retries', run: { status: 'failed', error: 'Rate limited.' } },
  ]);
  await decorateLatestRun(chat!, { provider: 'claude' });
  const off = await page.request.patch('/api/tickets/attention-settings', {
    data: { briefEnabled: false },
  });
  expect(off.ok()).toBe(true);
  await openHome(page);

  const notice = today(page).locator('.dg-off');
  await expect(notice).toContainText('The brief is off. Rules still sort the list below.');
  await expect(today(page).getByRole('button', { name: 'Refresh' })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Needs you' })).toContainText('Mock fetch retries');
  expect((await (await page.request.get('/api/home/digest')).json()).digest).toBeNull();

  await notice.getByRole('button', { name: 'Turn on (about $0.01 each)' }).click();
  await expect(notice).toHaveCount(0);
  await expect(brief(page).locator('.dg-headline')).toBeVisible({ timeout: 15_000 });
});
