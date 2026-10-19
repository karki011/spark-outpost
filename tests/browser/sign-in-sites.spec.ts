import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chatRepo, type ChatRepo, linkedChat, resetWithAgents, send } from './project-chat-kit.ts';
import { openTestDb } from './database.ts';
import { withDesktopBrowser } from './desktop-browser.ts';
import { SIGN_IN_FIXTURE } from './stub-config.ts';

const FAKE_HOST = process.env.SPARK_FAKE_BROWSER === '1';
const { username: USERNAME, password: PASSWORD } = SIGN_IN_FIXTURE;

let repo: ChatRepo;
let name = '';

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  name = path.basename(repo.root);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => {
  repo.remove();
});

async function link(page: Page): Promise<string> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function openSignIns(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  await page
    .getByRole('list', { name: 'Linked folders' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) })
    .click();
  return page.getByRole('group', { name: `Saved sign-ins in ${name}` });
}

async function query(sql: string, values: unknown[]) {
  const db = openTestDb();
  try {
    return await db.query(sql, values);
  } finally {
    await db.end();
  }
}

test('a sign-in keeps its other sites, and Add this site adds the one an agent was refused on', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await link(page);
  const block = await openSignIns(page);
  await block.getByRole('button', { name: `Add a sign-in to ${name}` }).click();
  const form = page.getByRole('form', { name: `New sign-in for ${name}` });
  await form.getByLabel('Label', { exact: true }).fill('Cost app');
  await form.getByLabel('Site', { exact: true }).fill('https://app.costs.example');
  await form.getByLabel('Other sign-in sites').fill('http://idp.costs.example');
  await form.getByLabel('Username', { exact: true }).fill(USERNAME);
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Add sign-in' }).click();
  await expect(form).toContainText('http://idp.costs.example is not a site Spark can sign in on');
  await form.getByLabel('Other sign-in sites').fill('auth.costs.example/u/login');
  await form.getByRole('button', { name: 'Add sign-in' }).click();

  const item = block.getByRole('listitem').filter({ hasText: 'Cost app' });
  await expect(item).toContainText('https://app.costs.example +1');
  const { rows } = await query(
    `UPDATE browser_sign_ins SET refused_site = 'https://costs.okta.example' RETURNING sites`,
    [],
  );
  expect(rows[0]).toEqual({ sites: ['https://auth.costs.example'] });
  await openSignIns(page);
  const refused = item.getByRole('status');
  await expect(refused).toContainText('An agent’s tab ended on https://costs.okta.example');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.set-project')
    .analyze();
  expect(axe.violations).toEqual([]);
  await refused
    .getByRole('button', { name: 'Add this site, https://costs.okta.example, to Cost app' })
    .click();
  await expect(item).toContainText('https://app.costs.example +2');
  await expect(item.getByRole('status')).toHaveCount(0);
  await item.getByRole('button', { name: 'Edit sign-in Cost app' }).click();
  await expect(page.getByLabel('Other sign-in sites')).toHaveValue(
    'https://auth.costs.example, https://costs.okta.example',
  );
});

async function handoffCard(): Promise<{ id: string; chatId: string }> {
  const { rows } = await query(
    `SELECT a.id, r.conversation_id AS "chatId" FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE a.payload->'sparkAction'->>'action' = 'browser_handoff' AND a.status = 'pending'
     ORDER BY a.created_at DESC LIMIT 1`,
    [],
  );
  return rows[0] as { id: string; chatId: string };
}

async function pushHandoff(page: Page) {
  const { id: approvalId, chatId } = await handoffCard();
  await page.evaluate(
    ([chat, id]) => {
      (window as unknown as { browserPush: (c: string, tabs: unknown[]) => void }).browserPush(
        chat!,
        [
          {
            title: 'Sign in',
            url: 'http://vault.test/login.html',
            owner: 'agent',
            active: true,
            kept: true,
            handoff: { agent: 'Claude', site: 'http://vault.test', approvalId: id },
          },
        ],
      );
    },
    [chatId, approvalId] as const,
  );
}

test('an agent hands its tab to the user to sign in, waits, and goes on after Done or Cancel', async ({
  page,
}) => {
  test.skip(!FAKE_HOST, 'Run with SPARK_FAKE_BROWSER=1 to give the worker a fake browser host.');
  await withDesktopBrowser(page);
  await link(page);
  await linkedChat(page, repo);
  await send(page, '#build #spark spark_browser_open {"url":"http://vault.test/login.html"}');
  await expect(page.getByText(/"outcome":"opened"/)).toBeVisible({ timeout: 45_000 });

  await send(page, '#build #spark spark_browser_sign_in {"handOver":true}');
  const card = page.getByRole('group', {
    name: /is waiting for you to sign in to http:\/\/vault\.test/,
  });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('The agent never sees what you type');
  await pushHandoff(page);
  await expect(page.getByRole('region', { name: 'Browser' })).toBeVisible();
  await pushHandoff(page);
  const banner = page.getByRole('region', { name: 'Sign in for the agent' });
  await expect(banner).toContainText('Claude is waiting for you to sign in to http://vault.test');
  await banner.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/"outcome":"handed_back"/)).toBeVisible({ timeout: 45_000 });

  await send(page, '#build #spark spark_browser_sign_in {"handOver":true}');
  const second = page
    .getByRole('group', { name: /is waiting for you to sign in to http:\/\/vault\.test/ })
    .last();
  await expect(second.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 45_000 });
  await second.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/"outcome":"cancelled"/)).toBeVisible({ timeout: 45_000 });
});
