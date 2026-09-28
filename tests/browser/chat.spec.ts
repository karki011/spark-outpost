import { expect, test, type Page } from '@playwright/test';
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
  const workLog = page.locator('.steps-head', { hasText: /Worked for \d+s/ });
  await expect(workLog).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await page.getByRole('navigation', { name: 'Chats' }).getByText(marker).click();
  await expect(reply).toHaveCount(1);
  await workLog.click();
  await expect(page.locator('.steps li', { hasText: 'Writing a reply' })).toBeVisible();
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
  await page.getByRole('menuitemradio', { name: 'Fjord' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'fjord');
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Fjord' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Theme' })).toBeHidden();
});

test('the theme picker lists every theme and applies the newer ones', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.getByRole('button', { name: 'Theme' }).click();
  await expect(page.getByRole('menu', { name: 'Theme' }).getByRole('menuitemradio')).toHaveText([
    'Match system',
    'Graphite',
    'Apricot',
    'Void',
    'Fjord',
    'Moss',
    'Lagoon',
    'Plum',
    'Sage',
    'Aurora',
    'Iris',
    'High contrast',
  ]);
  await page.keyboard.press('Escape');

  const newer = [
    { name: 'Lagoon', skin: 'lagoon', panel: '#fbfefe' },
    { name: 'Plum', skin: 'plum', panel: '#1c1520' },
    { name: 'Sage', skin: 'sage', panel: '#fbfcf8' },
    { name: 'Aurora', skin: 'aurora', panel: '#18152f' },
    { name: 'Iris', skin: 'iris', panel: '#fdfcff' },
  ];
  for (const { name, skin, panel } of newer) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
    const token = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
    );
    expect(token).toBe(panel);
    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(page.getByRole('menuitemradio', { name })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  }

  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe('iris');
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
  await expect(panel.getByRole('radiogroup', { name: 'Harness autonomy' })).toBeVisible();
  await expect(panel).toContainText('Plain chat: no project folder, so nothing can change');
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText('Chat');
  await page.keyboard.press('Escape');

  await input.fill('Hello');
  await input.press('Enter');
  await expect(page.locator('.ai-avatar.working')).toBeVisible();
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ai-avatar.done svg')).toBeVisible();
  const ring = page.getByRole('button', { name: /Context window: 6% used/ });
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
