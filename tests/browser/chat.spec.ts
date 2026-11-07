import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

test('sends a message, streams the reply, and survives a reload without duplicates', async ({
  page,
}) => {
  const marker = `Browser check ${Date.now()}`;
  const missing: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 404 && /^\/api\/conversations\/[^/]+$/.test(path)) missing.push(path);
  });
  const input = await newChat(page);
  const chats = page.getByRole('navigation', { name: 'Chats' });
  await expect(chats.getByRole('listitem')).toHaveCount(0);
  await expect(page.locator('.chat-title')).toHaveText('New chat');

  await input.fill(marker);
  await input.press('Enter');

  const reply = page.locator('.md', { hasText: `You wrote: "${marker}"` });
  await expect(reply).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText(marker);
  const replyRow = page.locator('.msg.ai .trow', { hasText: 'Writing a reply' });
  await expect(replyRow).toHaveCount(1);

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText(marker).click();
  await expect(reply).toHaveCount(1);
  await expect(replyRow).toHaveCount(1);
  await expect(replyRow).toBeVisible();
  await expect(page.locator('.bubble', { hasText: marker })).toHaveCount(1);
  expect(missing).toEqual([]);
});

test('Shift+Enter adds a line and Stop cancels the run', async ({ page }) => {
  const input = await newChat(page);

  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('second line');
  await expect(input).toHaveValue('First line\nsecond line');

  await input.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();

  await expect(page.locator('.mood', { hasText: 'stopped' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Stopped before finishing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('applies the saved theme before the app renders', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'apricot'));
  await openChats(page);
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('apricot');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Fjord · Void' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'fjord');
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Fjord · Void' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Theme' })).toBeHidden();
});

test('the theme menu sets the mode and a tint that follows the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openChats(page);
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('light');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menu', { name: 'Theme' }).getByRole('menuitemradio')).toHaveText([
    'Automatic',
    'Light',
    'Dark',
    'Graphite',
    'Apricot · Plum',
    'Lagoon · Moss',
    'Iris · Aurora',
    'Fjord · Void',
    'Sage · Loam',
  ]);
  await expect(page.getByRole('menuitemradio', { name: 'Automatic' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');

  const tints = [
    { name: 'Lagoon · Moss', light: 'lagoon', dark: 'moss', darkPanel: '#171b13' },
    { name: 'Iris · Aurora', light: 'iris', dark: 'aurora', darkPanel: '#18152f' },
    { name: 'Sage · Loam', light: 'sage', dark: 'loam', darkPanel: '#1a1913' },
  ];
  const panel = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
    );
  for (const { name, light, dark, darkPanel } of tints) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', light);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-skin', dark);
    expect(await panel()).toBe(darkPanel);
  }

  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'loam');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('loam');
  expect(await page.evaluate(() => localStorage.getItem('spark-outpost.theme'))).toBe(
    'dark.sage.system',
  );
});

test('Increase contrast switches to the high-contrast set on the matching side', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
  await openChats(page);
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'contrast');
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'contrast-dark');
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'graphite');
});

test('replies render Markdown safely', async ({ page }) => {
  const input = await newChat(page);
  await input.fill(
    '**bold** and `code` and [site](https://example.com) and [x](javascript:alert(1))',
  );
  await input.press('Enter');
  const reply = page.locator('.msg.ai .md').last();
  await expect(reply.locator('strong', { hasText: 'bold' })).toBeVisible({ timeout: 15_000 });
  await expect(reply.locator('code', { hasText: 'code' })).toBeVisible();
  await expect(reply.getByRole('link', { name: 'site' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await expect(reply.getByRole('link', { name: 'x' })).toHaveCount(0);
});

test('the composer picks a model and effort per chat and shows context use', async ({ page }) => {
  const input = await newChat(page);
  const picker = page.getByRole('button', { name: /^Model and effort/ });
  await expect(picker).toHaveAccessibleName('Model and effort: Fake Fast');
  await picker.click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('radio', { name: /Fake Deep/ }).click();
  await expect(picker).toHaveAccessibleName('Model and effort: Fake Deep');
  await panel.getByRole('tab', { name: /Effort/ }).click();
  await panel.getByRole('radio', { name: /^Low/ }).click();
  await expect(panel.getByRole('tab', { name: /Effort/ })).toContainText('Low');
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await expect(panel.getByRole('radiogroup', { name: 'Agent mode', exact: true })).toBeVisible();
  await expect(panel.getByRole('radiogroup', { name: /autonomy/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Spark autonomy/ })).toHaveCount(0);
  await expect(panel).not.toContainText('Plain chat');
  await expect(panel).not.toContainText('no folder');
  const tab = panel.getByRole('tab', { name: /Permissions/ });
  await expect(tab).toHaveText(/Plan$/);
  const modes = panel.getByRole('radiogroup', { name: 'Agent mode', exact: true });
  await modes.getByRole('radio', { name: 'Auto', exact: true }).click();
  await expect(modes.getByRole('radio', { name: 'Auto', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(panel).toContainText('Agent decides what to ask · files stay with this chat');
  await page.keyboard.press('Escape');
  const chip = page.getByRole('button', { name: /^Permissions: / });
  await expect(chip).toHaveAccessibleName('Permissions: Auto');
  await page.getByRole('button', { name: 'Choose project' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Pick a project to work in your code.');
  await page.mouse.move(0, 0);

  await input.fill('Hello #ctx62');
  await input.press('Enter');
  await expect(page.locator('.turn-working')).toBeVisible();
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.turn-working')).toHaveCount(0);
  const ring = page.getByRole('button', { name: /Context window: 62% used/ });
  await expect(ring).toBeVisible();

  const usage = page.locator('.run-usage');
  await expect(usage).toHaveText(/^1\.2K tokens · \$0\.004/);
  await usage.focus();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Input 900 · Output 300 · Cached read 600 · Thinking 80');
  await expect(tip).toContainText('Cost $0.004, as reported by Claude');
  await expect(tip).toContainText('fake-deep · low effort');
  await ring.click();
  await expect(page.getByRole('dialog', { name: 'Context window' })).toContainText(
    'This chat1.2K tokens · $0.004',
  );
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('button', { name: /^Model and effort/ })).toHaveAccessibleName(
    'Model and effort: Fake Deep',
  );

  await page.getByRole('button', { name: 'Add files and context' }).click();
  await expect(page.getByRole('menuitem', { name: 'Upload a file' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  const repo = page.getByRole('menuitem', { name: /Add from repo/ });
  await expect(repo).toContainText('Add a repo first');
  await repo.click();
  await expect(page.getByRole('dialog', { name: 'Project folders' })).toBeVisible();
});

async function savedChat(page: Page, title: string) {
  const id = randomUUID();
  const created = await page.request.post('/api/conversations', { data: { id } });
  expect(created.status()).toBe(201);
  const sent = await page.request.post(`/api/conversations/${id}/messages`, {
    data: { id: randomUUID(), content: title, attachmentIds: [], annotations: [], source: 'ui' },
  });
  expect(sent.ok()).toBe(true);
  return id;
}

test('opening a chat reuses its hover request and keeps a draft while history loads', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const id = await savedChat(page, 'History loading fixture');
  await savedChat(page, 'Other conversation');
  await openChats(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`**/api/conversations/${id}`, async (route) => {
    requests += 1;
    await held;
    await route.continue();
  });
  const row = page.locator(`[data-chat="${id}"] .row-open`);
  await row.hover();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('.chat-title')).not.toHaveText('History loading fixture');
  await row.click();
  await expect(page.locator('.chat-title')).toHaveText('History loading fixture');
  await expect(page.getByText('Opening this chat…')).toBeVisible();
  await expect(page.getByText('You can type while this chat opens')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose project', exact: true })).toBeHidden();
  await expect(page.locator('.bubble', { hasText: 'Other conversation' })).toBeHidden();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Keep this draft while loading');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(requests).toBe(1);
  await expect(page.locator('.thread-loading')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: testInfo.outputPath('loading-context.png'),
    animations: 'disabled',
  });
  release();
  await expect(page.locator('.bubble', { hasText: 'History loading fixture' })).toBeVisible();
  await expect(input).toHaveValue('Keep this draft while loading');
  await expect(page.getByText('Opening this chat…')).toBeHidden();
  expect(requests).toBe(1);
});

test('a failed chat load offers retry without discarding the typed draft', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const id = await savedChat(page, 'Recover loading fixture');
  await savedChat(page, 'Other conversation');
  await openChats(page);
  await page.route(`**/api/conversations/${id}`, async (route) => {
    const retryRequested = await page.evaluate(
      () => document.documentElement.dataset.retryRequested === 'true',
    );
    if (retryRequested) return route.continue();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporarily unavailable' }),
    });
  });
  await page.locator(`[data-chat="${id}"] .row-open`).click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Keep the recovery draft');
  await expect(page.getByText('Couldn’t open this chat. Your draft is kept.')).toBeVisible();
  await expect(page.locator('.thread-loading')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: testInfo.outputPath('loading-recovery.png'),
    animations: 'disabled',
  });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest('button');
        if (button?.textContent?.trim() === 'Try again') {
          document.documentElement.dataset.retryRequested = 'true';
        }
      },
      true,
    );
  });
  await retry.click();
  await expect(page.locator('.bubble', { hasText: 'Recover loading fixture' })).toBeVisible();
  await expect(input).toHaveValue('Keep the recovery draft');
});
