import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { openChats } from './navigation.ts';
import { toggleHeaderPane } from './header-menu.ts';

const SITE = 'https://example.com/';
const DOCS = 'https://example.com/docs';

interface Sent {
  chatId: string;
  command: { command: string; url?: string; tabId?: string };
}

test.beforeEach(async ({ context }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Example</title>' }),
  );
});

async function replyWithLinks(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByLabel('Message');
  await input.fill(`See [the site](${SITE}), [the docs](${DOCS}) and [mail](mailto:a@example.com)`);
  await input.press('Enter');
  const reply = page.locator('.msg.ai .md').last();
  await expect(reply.getByRole('link', { name: 'the site' })).toBeVisible({ timeout: 15_000 });
  return reply;
}

const sent = async (page: Page) =>
  ((await calls(page, 'command')) as Sent[]).map((call) => call.command);

async function pushTabs(page: Page, tabs: Record<string, unknown>[]) {
  const started = (await calls(page, 'start')) as { chatId: string }[];
  await page.evaluate(
    ([chatId, pushed]) =>
      (
        window as unknown as { browserPush(id: string, tabs: Record<string, unknown>[]): void }
      ).browserPush(chatId as string, pushed as Record<string, unknown>[]),
    [started[0]!.chatId, tabs] as const,
  );
}

test('a link in a reply opens in the Browser pane, not in a new window', async ({
  page,
  context,
}) => {
  await withDesktopBrowser(page);
  const reply = await replyWithLinks(page);
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeHidden();

  await reply.getByRole('link', { name: 'the site' }).click();
  await expect(pane).toBeVisible();
  await expect
    .poll(() => sent(page))
    .toEqual([
      { command: 'close', tabId: 't1' },
      { command: 'new_tab', url: SITE },
    ]);
  expect(((await calls(page, 'start')) as { bounds: unknown }[])[0]).toMatchObject({
    bounds: null,
    projectId: null,
  });

  await pushTabs(page, [{ url: SITE, title: 'Example', place: 'external', active: true }]);
  await expect(pane.getByRole('tab', { name: 'Example' })).toBeVisible();

  await reply.getByRole('link', { name: 'the docs' }).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await sent(page)).at(-1))
    .toEqual({ command: 'new_tab', url: DOCS });

  await reply.getByRole('link', { name: 'the site' }).click();
  await expect
    .poll(async () => (await sent(page)).at(-1))
    .toEqual({ command: 'select', tabId: 't1' });
  expect(context.pages()).toHaveLength(1);
});

test('Command-click and other schemes stay with the system', async ({ page, context }) => {
  await withDesktopBrowser(page);
  const reply = await replyWithLinks(page);
  const link = reply.getByRole('link', { name: 'the site' });

  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => context.pages().length).toBe(2);

  await expect(reply.getByRole('link', { name: 'mail' })).toHaveAttribute('target', '_blank');
  expect(await sent(page)).toEqual([]);
  await expect(page.getByRole('region', { name: 'Browser' })).toBeHidden();
});

test('a right-click on a chat link offers the pane, the default browser and a copy', async ({
  page,
  context,
}) => {
  await withDesktopBrowser(page);
  const reply = await replyWithLinks(page);
  const link = reply.getByRole('link', { name: 'the docs' });

  await link.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Link options' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Open in Spark browser',
    'Open in default browser',
    'Copy link',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Open in Spark browser' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(link).toBeFocused();

  await link.click({ button: 'right' });
  const [outside] = await Promise.all([
    context.waitForEvent('page'),
    menu.getByRole('menuitem', { name: 'Open in default browser' }).click(),
  ]);
  await expect(outside).toHaveURL(DOCS);
  await outside.close();
  expect(await sent(page)).toEqual([]);

  await link.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open in Spark browser' }).click();
  await expect
    .poll(async () => (await sent(page)).at(-1))
    .toEqual({ command: 'new_tab', url: DOCS });
});

test('the pane toolbar opens the page that is showing in the default browser', async ({
  page,
  context,
}) => {
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  const outside = pane.getByRole('button', { name: 'Open in default browser' });
  await expect(outside).toBeDisabled();

  await pushTabs(page, [{ url: DOCS, title: 'Docs', place: 'external', active: true }]);
  await expect(outside).toBeEnabled();
  await outside.focus();
  const [opened] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')]);
  await expect(opened).toHaveURL(DOCS);
  await opened.close();

  const own = new URL('/api/health', page.url()).href;
  await pushTabs(page, [{ url: own, active: true, error: 'ERR_BLOCKED_BY_CLIENT' }]);
  await expect(outside).toBeDisabled();
});

test('without the Mac app a chat link is an ordinary new-tab link, at phone size too', async ({
  page,
  context,
}) => {
  const reply = await replyWithLinks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const link = reply.getByRole('link', { name: 'the site' });
  await expect(link).toHaveAttribute('target', '_blank');

  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(opened).toHaveURL(SITE);
  await opened.close();
  await expect(page.getByRole('region', { name: 'Browser' })).toHaveCount(0);

  await link.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Link options' })).toHaveCount(0);
});
