import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { PROMPTS, ask, header, longChat, workPanel } from './chat-rail-kit.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });

test('a chat squeezed by the work panel floats the sidebar over it and docks it again', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await longChat(page, PROMPTS.slice(0, 1));
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await ask(page, PROMPTS.slice(1, 2));
  const second = (await page.locator('.chat-title').textContent())!;

  await page.evaluate(() => localStorage.setItem('spark-outpost.sidebar.width', '420'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const title = page.locator('.chat-title');
  await expect(title).not.toHaveText('');
  if ((await title.textContent()) !== PROMPTS[0]) {
    await sidebar(page).getByRole('button', { name: PROMPTS[0]!, exact: true }).click();
  }
  await expect(title).toHaveText(PROMPTS[0]!);
  const show = header(page).getByRole('button', { name: 'Show sidebar' });
  const toggle = header(page).getByRole('button', { name: /^(Show|Hide) work panel$/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-label')) === 'Show work panel') {
    await header(page).getByRole('button', { name: 'Show work panel' }).click();
  }
  await expect(workPanel(page)).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  await expect(show).toBeVisible();
  const main = page.getByRole('main');
  const width = (await main.boundingBox())!.width;

  await show.click();
  await expect(sidebar(page)).toBeVisible();
  expect((await main.boundingBox())!.width).toBe(width);
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toBeHidden();

  await show.click();
  const search = sidebar(page).getByRole('searchbox', { name: 'Search chats' });
  await search.fill('notes');
  const app = page.locator('.app');
  await expect(app).toHaveClass(/\bdrawer\b/);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(app).toHaveClass(/\bdrawer\b/);
  await expect(show).toHaveCount(0);
  await search.press('Escape');
  await expect(app).not.toHaveClass(/\bdrawer\b/);
  await expect(sidebar(page)).toBeHidden();

  await show.click();
  await expect(sidebar(page)).toBeVisible();
  await page.locator('.scrim').click({ position: { x: 600, y: 400 } });
  await expect(sidebar(page)).toBeHidden();

  await header(page).getByRole('button', { name: 'Hide work panel' }).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(show).toHaveCount(0);

  await sidebar(page).getByRole('button', { name: second, exact: true }).click();
  await expect(page.locator('.chat-title')).toHaveText(second);
  await expect(sidebar(page)).toBeVisible();
});
