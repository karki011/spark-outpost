import { expect, test, type Page } from '@playwright/test';
import { rail } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { openChats } from './navigation.ts';

const SITE = 'https://example.com/';

test.beforeEach(async ({ context }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await context.route('https://example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Example</title>' }),
  );
});

async function handLink(page: Page, url: string) {
  await page.evaluate(
    (address) =>
      (window as unknown as { browserViewOpenLink(url: string): void }).browserViewOpenLink(
        address,
      ),
    url,
  );
}

async function chooseLinksIn(page: Page, choice: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Browser pane' }).click();
  const setting = page
    .getByRole('dialog', { name: 'Browser pane' })
    .getByRole('group', { name: 'Open links in' });
  const picker = setting.getByRole('button', { name: 'Open links in' });
  await expect(picker).toHaveText('Spark');
  await picker.click();
  await page.getByRole('menuitemradio', { name: choice }).click();
  await expect(picker).toHaveText(choice);
  await page.keyboard.press('Escape');
}

test('a link the Mac app hands to Spark opens a tab in the profile last shown', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Browser' }).click();
  const side = page.getByRole('navigation', { name: 'Browser' });
  await side.getByRole('radiogroup', { name: 'Browser profile' }).getByText('Work').click();
  await rail(page).getByRole('button', { name: 'Chats' }).click();
  await expect(side).toBeHidden();

  await handLink(page, SITE);
  await expect(side).toBeVisible();
  await expect.poll(() => calls(page, 'view-open-tab')).toEqual([{ profile: 'work', url: SITE }]);

  await page.evaluate(() => {
    (window as unknown as { browserViewFull: boolean }).browserViewFull = true;
  });
  await handLink(page, `${SITE}more`);
  const problem = page.getByRole('alert').filter({ hasText: 'too many tabs' });
  await expect(problem).toBeVisible();
  await problem.getByRole('button', { name: 'Dismiss' }).click();
  await expect(problem).toBeHidden();
});

test('with Default browser chosen, a chat link leaves Spark and the pane stays closed', async ({
  page,
  context,
}) => {
  await withDesktopBrowser(page);
  await openChats(page);
  await chooseLinksIn(page, 'Default browser');
  expect(await calls(page, 'view-links-in')).toEqual(['browser']);

  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByLabel('Message');
  await input.fill(`See [the site](${SITE})`);
  await input.press('Enter');
  const link = page.locator('.msg.ai .md').last().getByRole('link', { name: 'the site' });
  await expect(link).toBeVisible({ timeout: 15_000 });

  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(opened).toHaveURL(SITE);
  await opened.close();
  expect(await calls(page, 'command')).toEqual([]);
  await expect(page.getByRole('region', { name: 'Browser' })).toBeHidden();

  await link.click({ button: 'right' });
  await expect(
    page.getByRole('menu', { name: 'Link options' }).getByRole('menuitem', {
      name: 'Open in Spark browser',
    }),
  ).toBeVisible();
});
