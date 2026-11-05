import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openTestDb } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';
import {
  card,
  chatRepo,
  type ChatRepo,
  linkedChat,
  resetWithAgents,
  send,
} from './project-chat-kit.ts';
import { animationsSettled } from './settle.ts';

const FAKE_HOST = process.env.SPARK_FAKE_BROWSER === '1';
const SITE = 'https://docs.example.com';
const WAIT = { timeout: 45_000 };

let repo: ChatRepo;

test.describe.configure({ timeout: 150_000 });

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => {
  repo.remove();
});

async function browserAudit(): Promise<string[]> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ line: string }>(
      `SELECT row_to_json(stored)::text AS line FROM run_protocol_log stored`,
    );
    return rows.map((row) => row.line).filter((line) => line.includes('spark/browser'));
  } finally {
    await db.end();
  }
}

function script(steps: unknown[]): string {
  return `#build #sparkscript ${JSON.stringify(steps)}`;
}

test('the pane marks the tab the agent is working on and says what it last did', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  const started = (await calls(page, 'start')) as { chatId: string }[];
  await page.evaluate(
    ({ chat, url }) => {
      (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
        chat,
        [
          {
            title: 'Docs',
            url,
            owner: 'agent',
            place: 'external',
            active: true,
            driving: true,
            lastAction: 'Clicked button "Search"',
          },
        ],
      );
    },
    { chat: started[0]!.chatId, url: `${SITE}/guide` },
  );
  await expect(pane.getByRole('status').filter({ hasText: 'Agent:' })).toHaveText(
    'Agent: Clicked button "Search"',
  );
  await expect(pane.getByRole('tab', { name: 'Agent Docs' }).locator('.bp-agent')).toHaveClass(
    /driving/,
  );
  await expect(pane.getByText('Spark is driving')).toBeVisible();
  await expect(pane.getByLabel('Address')).toHaveValue(`${SITE}/guide`);
  await animationsSettled(page);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.bp-head')
    .include('.bp-status')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test('an agent opens a site, reads it and acts on it after the user allows, with an audit trail and a flag', async ({
  page,
}) => {
  test.skip(!FAKE_HOST, 'Run with SPARK_FAKE_BROWSER=1 to give the worker a fake browser host.');
  await withDesktopBrowser(page);
  await linkedChat(page, repo);

  await send(page, `#build #spark spark_browser_open {"url":"${SITE}/guide?utm=campaign"}`);
  const openCard = card(page, /Let the agent open this site\?/);
  await expect(openCard).toBeVisible(WAIT);
  await expect(openCard).toContainText(`${SITE}/guide`);
  await expect(openCard).not.toContainText('utm=campaign');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.sac')
    .analyze();
  expect(axe.violations).toEqual([]);
  await openCard.getByRole('button', { name: 'Allow for this chat' }).click();
  await expect(page.getByText(/"outcome":"opened"/)).toBeVisible(WAIT);

  await send(page, '#build #spark spark_browser_read');
  await expect(
    page.getByText(/page_evidence url="https:\/\/docs\.example\.com\/guide"/),
  ).toBeVisible(WAIT);
  await expect(card(page, /Let the agent read this page\?/)).toHaveCount(0);

  await send(page, '#build #spark spark_browser_act {"action":"click","ref":"ref_1"}');
  const actCard = card(page, /Let the agent click and type on this site\?/);
  await expect(actCard).toBeVisible(WAIT);
  await expect(actCard).toContainText('Clicked button "Search"');
  await expect(actCard).toContainText('The agent’s');
  await actCard.getByRole('button', { name: 'Allow for this chat' }).click();
  await expect(page.getByText(/"outcome":"done"/)).toBeVisible(WAIT);

  await send(page, '#build #spark spark_browser_act {"action":"type","ref":"ref_3","text":"x"}');
  await expect(page.getByText(/Agents never type into those/)).toBeVisible(WAIT);

  await send(
    page,
    script([
      { tool: 'spark_chats' },
      { tool: 'spark_browser_act', args: { action: 'type', ref: 'ref_2', text: 'refund policy' } },
      { say: 'typed it' },
    ]),
  );
  await expect(page.getByText('typed it')).toBeVisible(WAIT);
  const sent = /sent data to docs\.example\.com after reading private work data \(spark_chats\)/;
  const line = page.locator('.flag-line');
  await expect(line).toContainText(sent, WAIT);
  await line.getByRole('button', { name: 'Details' }).click();
  const flag = page.getByRole('region', { name: 'Flagged by Spark' });
  await expect(flag).toContainText(sent);
  await expect(card(page, /click and type on this site\?/)).toHaveCount(1);

  const audit = await browserAudit();
  const joined = audit.join('\n');
  expect(joined).toContain('spark_browser_open');
  expect(joined).toContain('spark_browser_act');
  expect(joined).toContain('Clicked button \\"Search\\"');
  expect(joined).toContain('user_allowed');
  expect(joined).toContain('allowed_earlier');
  expect(joined).toContain('sensitive_field');
  expect(joined).not.toContain('utm=campaign');
  expect(joined).not.toContain('q=clicked');
  expect(joined).not.toContain('refund policy');
});
