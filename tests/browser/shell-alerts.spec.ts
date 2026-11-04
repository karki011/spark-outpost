import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { AttentionList } from '../../packages/contracts/src/attention-items.ts';
import { resetTestDatabase } from './database.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });
const row = (page: Page, id: string) => page.locator(`[data-chat="${id}"] .row-open`);

async function savedChat(page: Page, title: string): Promise<string> {
  const id = randomUUID();
  expect((await page.request.post('/api/conversations', { data: { id } })).status()).toBe(201);
  const sent = await page.request.post(`/api/conversations/${id}/messages`, {
    data: { id: randomUUID(), content: title, attachmentIds: [], annotations: [], source: 'ui' },
  });
  expect(sent.ok()).toBe(true);
  return id;
}

async function shellAlerts(page: Page): Promise<AttentionList['items']> {
  const { items } = (await (await page.request.get('/api/attention')).json()) as AttentionList;
  return items.filter((item) => item.kind === 'shell-alert');
}

test('a shell tab alert shows on its chat row as an update and is read when the chat opens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.goto('/');
  const building = await savedChat(page, 'Build the app');
  const other = await savedChat(page, 'Something else');
  await openChats(page);
  await row(page, building).click();
  await expect(page.locator('.chat-title')).toHaveText('Build the app');
  await toggleHeaderPane(page, 'Terminal');
  await expect(dock(page).locator('.term-light.open')).toBeVisible();

  await row(page, other).click();
  await expect(page.locator('.chat-title')).toHaveText('Something else');
  await expect.poll(async () => (await shellAlerts(page)).length).toBe(0);

  await row(page, building).click();
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await dock(page).locator('.xterm').click();
  await page.keyboard.type(
    "sleep 1; printf '\\033]9;4;1;50\\007\\033]777;notify;Build;done in 12s\\007'",
  );
  await page.keyboard.press('Enter');
  await row(page, other).click();
  await expect(page.locator('.chat-title')).toHaveText('Something else');

  await expect.poll(async () => (await shellAlerts(page)).length, { timeout: 10_000 }).toBe(1);
  await expect(row(page, building)).toHaveAttribute('title', /Shell tab: Build: done in 12s/);
  const [alert] = await shellAlerts(page);
  expect(alert).toMatchObject({ blocking: false, detail: 'Build: done in 12s', readAt: null });
  await expect(page.getByRole('button', { name: /needs you/i })).toHaveCount(0);

  await row(page, building).click();
  await expect.poll(async () => (await shellAlerts(page)).length).toBe(0);
  await row(page, other).click();
  await expect(row(page, building)).not.toHaveAttribute('title', /Shell tab:/);
});
