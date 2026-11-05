import { expect, test, type Page } from '@playwright/test';
import { axeInEveryTheme } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const MESSAGE = [
  'Compare https://example.com/docs/guides/setup/start.',
  'and (https://en.wikipedia.org/wiki/Spark_(software)), again https://example.com/docs/guides/setup/start',
  'not https://user:secret@example.com/private or ftp://files.example.com/a',
  `also https://example.org/${'deep/'.repeat(60)}end?q=1 http://[::1]:8080/status https://example.net`,
].join('\n');

async function sendLinks(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(MESSAGE);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  await page.getByRole('button', { name: 'Send anyway' }).click();
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ context }) => {
  await resetTestDatabase({ onboarded: true });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'stub' }),
  );
});

test('shows link cards beside the message and opens them from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await sendLinks(page);

  const mine = page.locator('.msg.me');
  await expect(mine.locator('.bubble')).toContainText('https://user:secret@example.com/private');
  const group = mine.getByRole('group', { name: 'Links' });
  const cards = group.getByRole('link');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('href', 'https://example.com/docs/guides/setup/start');
  await expect(cards.nth(0)).toHaveAttribute(
    'title',
    'https://example.com/docs/guides/setup/start',
  );
  await expect(cards.nth(0).locator('.link-card-host')).toHaveText('example.com');
  await expect(cards.nth(0).locator('.link-card-path')).toHaveText('/docs/…/start');
  await expect(cards.nth(1)).toHaveAttribute(
    'href',
    'https://en.wikipedia.org/wiki/Spark_(software)',
  );
  await expect(cards.nth(2).locator('.link-card-path')).toHaveText('/deep/…/end?…');
  await expect(group).toContainText('+2 more');
  await expect(group).not.toContainText('secret');
  await expect(group).not.toContainText('files.example.com');
  expect(requested.filter((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url))).toEqual([]);

  await cards.nth(1).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(cards.nth(0)).toBeFocused();
  const outline = await cards.nth(0).evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('none');
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  expect((await popup).url()).toBe('https://example.com/docs/guides/setup/start');

  await axeInEveryTheme(page, '.link-cards');
});

test('link cards fit a 320px phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await sendLinks(page);
  await page.setViewportSize({ width: 320, height: 640 });
  const group = page.locator('.msg.me').getByRole('group', { name: 'Links' });
  await expect(group.getByRole('link')).toHaveCount(3);
  await group.scrollIntoViewIfNeeded();
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  for (const card of await group.getByRole('link').all()) {
    const box = await card.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
  }
  const column = page.locator('.msg.me');
  expect(await column.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
    0,
  );
});
