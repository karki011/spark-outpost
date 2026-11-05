import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  SPARK_ACTION_OPTION,
  type ConfluenceEditAction,
  type JiraEditAction,
  type SparkAction,
} from '../../packages/contracts/src/index.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from '../../apps/server/test/fake-jira.ts';
import {
  axeInEveryTheme,
  connectorCard,
  connectorHead,
  connectorStatus,
} from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';
import { seedChats } from './sidebar-seed.ts';
import { connectTickets, resetTicketFakes, STUB_URL } from './ticket-seed.ts';

const SHOTS = process.env.ATLASSIAN_SHOTS ?? '';

test.describe.configure({ timeout: 120_000 });

const card = (page: Page) => connectorCard(page, 'atlassian');

async function openCard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await connectorHead(card(page)).click();
}

async function products(page: Page) {
  const response = await page.request.get('/api/tickets/connections');
  const body = (await response.json()) as {
    connections: { source: string; atlassian: Record<string, { on: boolean }> | null }[];
  };
  return body.connections.find((entry) => entry.source === 'jira')?.atlassian ?? null;
}

async function shoot(page: Page, name: string, target: Locator) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 1280, height: 1400 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => delete document.documentElement.dataset.skin);
    await animationsSettled(page);
    await target.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
});

test('shows Jira and Confluence with their own switches and saves them', async ({ page }) => {
  await connectTickets(page, ['jira']);
  await openCard(page);
  await expect(connectorStatus(card(page))).toHaveText(`${STUB_URL} · ${JIRA_EMAIL}`);
  await expect(card(page).locator('.pill-ok')).toHaveText('Connected');
  const jira = card(page).getByRole('switch', { name: 'Jira', exact: true });
  const confluence = card(page).getByRole('switch', { name: 'Confluence' });
  await expect(jira).toHaveAttribute('aria-checked', 'true');
  await expect(confluence).toHaveAttribute('aria-checked', 'true');
  await expect(confluence).toHaveAccessibleDescription(/Agents search, read, create/);
  await expect(card(page)).not.toContainText(JIRA_TOKEN);
  await shoot(page, 'atlassian-card', card(page));

  await confluence.focus();
  await page.keyboard.press('Space');
  await expect(confluence).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await products(page))?.confluence?.on).toBe(false);
  await jira.click();
  await expect(jira).toHaveAttribute('aria-checked', 'false');
  await expect(
    card(page).getByRole('switch', { name: 'Move tickets to Done when the PR merges' }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await connectorHead(card(page)).click();
  await expect(card(page).getByRole('switch', { name: 'Jira', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await axeInEveryTheme(page, '[data-connector="atlassian"]');
});

test('says plainly when the token cannot reach Confluence', async ({ page }) => {
  await fetch(`${STUB_URL}/tickets-test/confluence-off`);
  await connectTickets(page, ['jira']);
  await openCard(page);
  const confluence = card(page).getByRole('switch', { name: 'Confluence' });
  await expect(confluence).toHaveAttribute('aria-checked', 'false');
  await expect(confluence).toHaveAccessibleDescription(
    /This token can’t reach Confluence on this site/,
  );
  await confluence.click();
  await expect(card(page).getByRole('alert')).toContainText(
    "This token can't reach Confluence on this site, so Confluence stays off.",
  );
  await expect(confluence).toHaveAttribute('aria-checked', 'false');
});

test('asks before Disconnect in a dialog, and Esc keeps the connection', async ({ page }) => {
  await connectTickets(page, ['jira']);
  await openCard(page);
  const more = card(page).getByRole('button', { name: 'Options for Atlassian' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Disconnect…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect Atlassian?' });
  await expect(dialog).toContainText('Nothing changes on your Atlassian site.');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Disconnect', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await shoot(page, 'atlassian-disconnect', page.locator('body'));
  await axeInEveryTheme(page, '.cx-confirm');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  expect(await products(page)).not.toBeNull();

  await more.click();
  await page.getByRole('menuitem', { name: 'Disconnect…' }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card(page).getByRole('form', { name: 'Connect Atlassian' })).toBeVisible();
  expect(await products(page)).toBeNull();
});

const ISSUE = {
  key: 'WEB-418',
  title: 'Export the usage table as CSV',
  url: `${STUB_URL}/browse/WEB-418`,
};

const jiraUpdate: JiraEditAction = {
  action: 'jira_edit',
  op: 'update',
  ticket: ISSUE,
  updated: '2026-09-27T12:00:00.000+0000',
  changes: { summary: 'Export usage as CSV', labels: ['csv'] },
  before: {
    summary: ISSUE.title,
    description: 'People want the usage table in a spreadsheet.',
    labels: ['frontend'],
    priority: 'Medium',
  },
  after: {
    summary: 'Export usage as CSV',
    description: 'People want the usage table in a spreadsheet.',
    labels: ['csv'],
    priority: 'Medium',
  },
  comment: null,
  subtasks: [],
};

const pageDelete: ConfluenceEditAction = {
  action: 'confluence_edit',
  op: 'delete',
  page: {
    id: '9002',
    title: 'Rollback plan',
    url: `${STUB_URL}/wiki/spaces/ENG/pages/9002`,
    version: 1,
    spaceId: '501',
    space: 'ENG · Engineering',
    parentId: '9001',
  },
  body: null,
  before: { title: 'Rollback plan', text: 'Revert the deploy.' },
  after: null,
};

function cardFor(action: SparkAction, title: string, confirm: string) {
  return {
    kind: 'spark_action',
    title,
    payload: {
      sparkAction: action,
      sparkResult: { state: 'waiting', message: null, url: null },
    },
    options: [
      { optionId: SPARK_ACTION_OPTION.confirm, name: confirm, kind: 'allow_once' },
      { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
    ],
  };
}

async function openChat(page: Page, title: string) {
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: new RegExp(`^${title}`) })
    .click();
}

test('a Jira change card shows the issue before and after with a link to it', async ({ page }) => {
  await seedChats([
    {
      title: 'Tidy the backlog',
      run: { status: 'awaiting_approval' },
      approval: cardFor(
        jiraUpdate,
        `Change this ticket? ${ISSUE.key} ${ISSUE.title}`,
        'Save change',
      ),
    },
  ]);
  await openChat(page, 'Tidy the backlog');
  const change = page.getByRole('group', { name: /Change this ticket\?/ });
  await expect(change).toContainText('asks Spark to do this in Jira.');
  await expect(change.getByRole('link', { name: `WEB-418 · ${ISSUE.title}` })).toHaveAttribute(
    'href',
    ISSUE.url,
  );
  await expect(change).toContainText(
    /Summary.*Export the usage table as CSV.*→.*Export usage as CSV/,
  );
  await expect(change).toContainText(/Labels.*frontend.*→.*csv/);
  await expect(change).not.toContainText('Description now');
  await expect(change.getByRole('button', { name: 'Save change' })).toBeVisible();
  await shoot(page, 'jira-update-card', change);
  await axeInEveryTheme(page, '.sac');
});

test('a Confluence delete card says the page goes to the trash', async ({ page }) => {
  await seedChats([
    {
      title: 'Clean up the wiki',
      run: { status: 'awaiting_approval' },
      approval: cardFor(
        pageDelete,
        'Move this page to the Confluence trash? Rollback plan',
        'Move to trash',
      ),
    },
  ]);
  await openChat(page, 'Clean up the wiki');
  const remove = page.getByRole('group', { name: /Move this page to the Confluence trash\?/ });
  await expect(remove).toContainText('ENG · Engineering');
  await expect(remove).toContainText('Rollback plan (version 1)');
  await expect(remove).toContainText('Revert the deploy.');
  await expect(remove).toContainText('The page goes to the Confluence trash.');
  await expect(remove.getByRole('button', { name: 'Move to trash' })).toBeVisible();
  await shoot(page, 'confluence-delete-card', remove);
  await axeInEveryTheme(page, '.sac');
});
