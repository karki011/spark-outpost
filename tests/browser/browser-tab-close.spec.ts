import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

const APPROVAL = '33333333-2222-4333-8444-555555555555';
const handoff = { agent: 'Claude', site: 'https://idp.example.com', approvalId: APPROVAL };

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

async function push(page: Page, chatId: string, tabs: Record<string, unknown>[]) {
  await page.evaluate(
    ([chat, items]) => {
      (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
        chat as string,
        items as unknown[],
      );
    },
    [chatId, tabs] as const,
  );
}

function recordDecisions(page: Page): Promise<unknown[]> {
  const decisions: unknown[] = [];
  return page
    .route(`**/approvals/${APPROVAL}/decision`, async (route) => {
      decisions.push(route.request().postDataJSON());
      await route.fulfill({ status: 404, json: { error: 'gone' } });
    })
    .then(() => decisions);
}

const page1 = { title: 'Docs', url: 'https://docs.example.com/a', active: true };

const cases: [string, Record<string, unknown>][] = [
  ['a normal tab', page1],
  ['an agent tab kept open after the user used it', { ...page1, owner: 'agent', kept: true }],
  ['a page with beforeunload', { ...page1, title: 'Unsaved draft' }],
  ['a tab whose page crashed', { ...page1, error: 'The page stopped working.' }],
];

for (const [name, tab] of cases) {
  test(`the close button closes ${name}`, async ({ page }) => {
    await withDesktopBrowser(page);
    const decisions = await recordDecisions(page);
    const { pane, chatId } = await openPane(page);
    await push(page, chatId, [tab]);
    await pane.getByRole('button', { name: `Close ${tab.title as string}` }).click();
    await expect
      .poll(async () => (await calls(page, 'command')).at(-1))
      .toEqual({ chatId, command: { command: 'close', tabId: 't1' } });
    expect(decisions).toEqual([]);
  });
}

test('closing a tab waiting on a sign-in cancels the hand-off after the close', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  const decisions = await recordDecisions(page);
  const { pane, chatId } = await openPane(page);
  const waiting = { title: 'Sign in', url: 'https://idp.example.com/login', owner: 'agent' };
  await push(page, chatId, [{ ...waiting, active: true, kept: true, handoff }]);
  await expect(pane.getByText('Claude is waiting for you to sign in to')).toBeVisible();
  await pane.getByRole('button', { name: 'Close Sign in' }).click();
  await expect.poll(() => decisions).toEqual([{ optionId: 'decline', scope: 'once' }]);
  expect((await calls(page, 'command')).at(-1)).toEqual({
    chatId,
    command: { command: 'close', tabId: 't1' },
  });

  await push(page, chatId, [{ ...waiting, active: true, kept: true, handoff }]);
  await pane.getByRole('button', { name: 'Close Sign in' }).focus();
  await page.keyboard.press('ControlOrMeta+W');
  await expect.poll(() => decisions.length).toBe(2);
});
