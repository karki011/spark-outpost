import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  connectTickets,
  denyJiraAssign,
  openTickets,
  resetTicketFakes,
  seedAssignedSince,
} from './ticket-seed.ts';
import { LINEAR_KEY } from '../../apps/server/test/fake-linear.ts';

const main = (page: Page) => page.getByRole('main', { name: 'Tickets' });
const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const row = (page: Page, key: string) => main(page).locator(`li[data-ticket$=":${key}"]`);

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('the empty state connects Atlassian first, then checks a Linear key', async ({ page }) => {
  await openTickets(page);
  await expect(page.getByRole('heading', { name: 'See your tickets here' })).toBeVisible();
  const cta = page.locator('.tk-cta .btn');
  await expect(cta.first()).toHaveText('Connect Atlassian');
  await expect(cta.first()).toHaveClass(/primary/);

  await page.getByRole('button', { name: 'Connect Atlassian' }).click();
  const jira = page.getByRole('form', { name: 'Connect Atlassian' });
  await expect(jira.getByLabel('Site URL')).toBeFocused();
  await expect(jira.getByRole('link', { name: /Create an API token/ })).toHaveAttribute(
    'href',
    'https://id.atlassian.com/manage-profile/security/api-tokens',
  );
  await jira.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Connect Atlassian' })).toBeFocused();

  await page.getByRole('button', { name: 'Connect Linear' }).click();
  const form = page.getByRole('form', { name: 'Connect Linear' });
  await expect(form.getByRole('link', { name: /Create a personal API key/ })).toHaveAttribute(
    'target',
    '_blank',
  );
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('alert')).toHaveText('Paste the full Linear API key.');

  await form.getByLabel('API key').fill('lin_api_wrong_0123456789abcdefghij');
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('status')).toHaveText('Checking with Linear…');
  await expect(form.getByRole('alert')).toContainText('Linear rejected this key');
  await expect(form.getByLabel('API key')).toHaveAttribute('aria-invalid', 'true');

  await form.getByLabel('API key').fill(LINEAR_KEY);
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.getByRole('status')).toHaveText('Connected!', { timeout: 10_000 });
  await expect(section(page, 'Needs you')).toBeVisible({ timeout: 15_000 });
  await expect(row(page, 'ENG-1215')).toContainText('Due today');
});

test('the inbox sorts tickets into sections and opens a ticket', async ({ page }) => {
  await connectTickets(page);
  await seedAssignedSince([['WEB-433', 3]]);
  await openTickets(page);

  const attention = section(page, 'Needs you');
  await expect(attention.locator('li')).toHaveCount(3, { timeout: 15_000 });
  await expect(row(page, 'WEB-433')).toContainText('Urgent · not started');
  await expect(row(page, 'API-81')).toContainText('Blocked');
  await expect(section(page, 'Started')).toContainText('WEB-421');
  await expect(row(page, 'WEB-421')).toContainText('In Progress');
  await expect(row(page, 'WEB-421')).not.toContainText('No chat yet');
  await expect(section(page, 'In review / PR open').locator('li')).toHaveCount(2);
  await expect(section(page, 'Up next')).toContainText('ENG-1210');
  const done = section(page, 'Done recently');
  await expect(done.getByRole('button', { name: /^Done recently/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByLabel('3 tickets need attention'),
  ).toBeVisible();

  const views = main(page).getByRole('navigation', { name: 'Ticket views' });
  await views.getByRole('button', { name: 'Up next 2' }).click();
  await expect(main(page).locator('li.irow')).toHaveCount(2);
  await views.getByRole('button', { name: /^Inbox/ }).click();

  await row(page, 'WEB-433')
    .getByRole('button', { name: /WEB-433/ })
    .first()
    .click();
  const detail = page.getByRole('complementary', { name: 'WEB-433 details' });
  await expect(detail).toContainText('Why it needs attention');
  await expect(detail).toContainText('Rule: High or Urgent, not started');
  await expect(detail.getByRole('heading', { name: 'Acceptance criteria' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('complementary', { name: 'ENG-1215 details' })).toBeVisible();
});

test('search covers every ticket and Assign to me confirms before taking one', async ({ page }) => {
  await connectTickets(page);
  await openTickets(page);
  await expect(section(page, 'Needs you')).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press('/');
  await page.keyboard.type('upload');
  await expect(main(page).getByRole('status').filter({ hasText: 'results' })).toContainText(
    'across all tickets in Linear and Jira',
  );
  await expect(section(page, 'Unassigned').locator('li')).toHaveCount(2);
  await expect(section(page, 'Assigned to others')).toContainText('Assigned to Jordan Lee');

  await row(page, 'WEB-440').hover();
  await page.getByRole('button', { name: 'Assign WEB-440 to me' }).click();
  const toasts = page.locator('.tk-toasts');
  await expect(toasts.getByText('Assigned WEB-440 to you in Linear.')).toBeVisible();
  await expect(section(page, 'Assigned to you')).toContainText('WEB-440');
  await toasts.getByRole('button', { name: 'Undo' }).click();
  await expect(toasts.getByText('WEB-440 is unassigned again.')).toBeVisible();
  await expect(section(page, 'Unassigned')).toContainText('WEB-440');

  await row(page, 'WEB-437').hover();
  await page.getByRole('button', { name: 'Assign WEB-437 to me' }).click();
  const confirm = page.getByRole('dialog', { name: 'Take WEB-437 from Jordan Lee?' });
  await expect(confirm.getByRole('button', { name: 'Assign to me' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await row(page, 'WEB-437').hover();
  await page.getByRole('button', { name: 'Assign WEB-437 to me' }).click();
  await confirm.getByRole('button', { name: 'Assign to me' }).click();
  await expect(toasts.getByText('Assigned WEB-437 to you in Linear.')).toBeVisible();

  await denyJiraAssign();
  await row(page, 'API-95').hover();
  await page.getByRole('button', { name: 'Assign API-95 to me' }).click();
  await expect(row(page, 'API-95').getByRole('alert')).toHaveText(
    "Jira says you can't assign issues in API. Ask a project admin for the Assign issues permission. Nothing changed.",
  );

  await page.keyboard.press('Escape');
  await page.getByRole('searchbox').press('Escape');
  await expect(section(page, 'Needs you')).toBeVisible();
});

test('Start from a ticket creates a linked chat', async ({ page }) => {
  await connectTickets(page);
  await openTickets(page);
  await row(page, 'ENG-1210').hover({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Start ENG-1210' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start work on ENG-1210' });
  await expect(dialog.getByRole('radio', { name: 'Chat', exact: true })).toBeFocused();
  await expect(dialog).toContainText('Move ENG-1210 to In progress in Linear');
  await dialog.getByRole('button', { name: 'Start with a plan' }).click();
  await expect(page.locator('.chat-title')).toContainText('ENG-1210', { timeout: 15_000 });
});

test('the Tickets strip shows the Home brief, and each side links to the other', async ({
  page,
}) => {
  await connectTickets(page);
  await seedAssignedSince([['WEB-433', 3]]);
  await openTickets(page);
  await expect(section(page, 'Needs you').locator('li')).toHaveCount(3, { timeout: 15_000 });

  const rail = page.getByRole('navigation', { name: 'Main' });
  await rail.getByRole('button', { name: /^Home/ }).click();
  const pickup = page.getByRole('region', { name: 'Pick up where you left off' });
  const items = pickup.getByRole('list', { name: 'Pick up where you left off' });
  await expect(items.getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await expect(items).toContainText('WEB-433');
  await expect(items).toContainText('Session expires during long uploads');
  await expect(items).toContainText('Handle WEB-433: Urgent · not started.');
  await expect(pickup.locator('.dg-meta')).toHaveText(/^Nothing is flagged · Generated /);
  await expect(pickup).not.toContainText('FAKE-404');

  await items.getByRole('button', { name: 'Open WEB-433' }).click();
  await expect(page.getByRole('complementary', { name: 'WEB-433 details' })).toBeVisible();
  const strip = main(page).getByRole('region', { name: 'What needs you today' });
  await expect(strip.getByRole('listitem')).toHaveCount(3);
  await expect(strip).toContainText('Handle WEB-433: Urgent · not started.');
  await expect(strip.getByRole('button', { name: 'Start WEB-433' })).toBeVisible();
  await strip.getByRole('button', { name: 'Show ENG-1215' }).click();
  await expect(page.getByRole('complementary', { name: 'ENG-1215 details' })).toBeVisible();

  await main(page).getByRole('radio', { name: 'Compact' }).click();
  await expect(strip).toHaveCount(0);
  await main(page).getByRole('radio', { name: 'Comfortable' }).click();
  await strip.getByRole('button', { name: 'Full brief on Home' }).click();
  await expect(pickup).toBeVisible();
});

test('the Tickets strip says when the brief is off and turns it on', async ({ page }) => {
  await connectTickets(page);
  await page.request.patch('/api/tickets/attention-settings', { data: { briefEnabled: false } });
  await openTickets(page);
  const off = main(page).getByRole('region', { name: 'Brief is off' });
  await expect(off).toContainText('The rules still flag tickets under Needs you.', {
    timeout: 15_000,
  });
  await off.getByRole('button', { name: 'Turn on' }).click();
  await expect(main(page).getByRole('region', { name: 'What needs you today' })).toBeVisible({
    timeout: 15_000,
  });
});

for (const failure of [false, true]) {
  test(`refresh ${failure ? 'failure and retry' : 'success'} keeps Tickets interactive`, async ({
    page,
  }) => {
    await connectTickets(page);
    await openTickets(page);
    await expect(row(page, 'API-81')).toBeVisible();
    await row(page, 'API-81').getByRole('button').first().click();
    const refresh = page.getByRole('button', { name: 'Refresh tickets' });
    await expect(refresh).toBeEnabled();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route('**/api/tickets/inbox', async (route) => {
      requests += 1;
      await pending;
      if (failure)
        await route.fulfill({ status: 503, json: { error: 'Sync temporarily unavailable' } });
      else await route.continue();
    });
    try {
      await refresh.click();
      await expect(main(page).getByRole('status').filter({ hasText: 'Syncing…' })).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Connectors', exact: true }).click();
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await expect(page.locator('.set')).toHaveCount(0);
      await main(page).getByRole('radio', { name: 'Compact', exact: true }).click();
      await expect(main(page)).toHaveClass(/compact/);
      await page.getByRole('searchbox').fill('API-77');
      await expect(page.getByRole('searchbox')).toHaveValue('API-77');
    } finally {
      release();
    }
    await expect(refresh).toBeEnabled();
    if (failure) {
      expect(requests).toBe(2);
      await page.unroute('**/api/tickets/inbox');
      const synced = page.waitForResponse(
        (response) => response.url().endsWith('/api/tickets/inbox') && response.ok(),
      );
      await refresh.click();
      await synced;
      await expect(refresh).toBeEnabled();
    }
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Home', exact: true })
      .click();
    await expect(main(page)).toHaveCount(0);
  });
}

test('sync completion leaves ticket menus and Start work dismissible', async ({ page }) => {
  await connectTickets(page);
  await openTickets(page);
  await expect(row(page, 'API-81')).toBeVisible();
  const refresh = page.getByRole('button', { name: 'Refresh tickets' });
  for (const surface of ['source', 'start'] as const) {
    await expect(refresh).toBeEnabled();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/tickets/inbox', async (route) => {
      await pending;
      await route.continue();
    });
    try {
      await refresh.click();
      await expect(refresh).toBeDisabled();
      if (surface === 'source') {
        await main(page).getByRole('button', { name: 'Source', exact: true }).click();
        await expect(page.getByRole('menu', { name: 'Source', exact: true })).toBeVisible();
      } else {
        await row(page, 'API-81').hover();
        await page.getByRole('button', { name: 'Start API-81', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Start work on API-81' })).toBeVisible();
      }
    } finally {
      release();
    }
    await expect(refresh).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tk .dlg')).toHaveCount(0);
    await expect(page.getByRole('menu', { name: 'Source', exact: true })).toBeHidden();
    await expect
      .poll(() =>
        refresh.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit !== null && button.contains(hit);
        }),
      )
      .toBe(true);
    await page.unroute('**/api/tickets/inbox');
    await main(page).getByRole('button', { name: 'Team or project', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'All teams and projects', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Team or project', exact: true })).toBeHidden();
    await row(page, 'API-81').getByRole('button').first().click();
    await expect(main(page).getByRole('complementary', { name: 'API-81 details' })).toBeVisible();
  }
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(main(page)).toHaveCount(0);
});
