import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function openPane(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  const started = (await calls(page, 'start')) as { chatId: string }[];
  return { pane, chatId: started[0]!.chatId };
}

async function push(page: Page, chatId: string, tab: Record<string, unknown>) {
  await page.evaluate(
    ([chat, item]) => {
      (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
        chat as string,
        [item],
      );
    },
    [chatId, tab] as const,
  );
}

const agentTab = { title: 'Docs', url: 'http://localhost:5173/docs', owner: 'agent', active: true };

test('an agent tab says when it closes, and pinning it keeps it', async ({ page }) => {
  await withDesktopBrowser(page);
  const { pane, chatId } = await openPane(page);
  await push(page, chatId, agentTab);
  const life = pane.getByRole('group', { name: 'Agent tab' });
  await expect(life).toHaveText('Closes when this turn ends·Pin to keep');
  await life.getByRole('button', { name: 'Pin to keep' }).click();
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId,
    command: { command: 'pin', tabId: 't1', pinned: true },
  });

  await push(page, chatId, { ...agentTab, kept: true });
  await expect(
    pane.getByRole('status').filter({ hasText: 'Kept open until you close it' }),
  ).toBeVisible();
  await expect(life).toBeHidden();

  await push(page, chatId, { ...agentTab, pinned: true });
  await expect(pane.getByText('Kept open until you close it')).toBeHidden();
  await expect(life).toBeHidden();

  await push(page, chatId, { ...agentTab, owner: 'user' });
  await expect(life).toBeHidden();
});
