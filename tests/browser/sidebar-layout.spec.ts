import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const titles = (page: Page) => sidebar(page).locator('.cblock .row .tt');

async function openMenu(page: Page, title: string) {
  const row = sidebar(page).getByRole('listitem').filter({ hasText: title });
  await row.hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  return page.getByRole('menu', { name: `Options for ${title}` });
}

test('New chat sits at the bottom of the sidebar and has a shortcut', async ({ page }) => {
  await seedChats([{ title: 'Old chat' }]);
  await page.goto('/');
  await expect(page.locator('.chat-title')).toHaveText('Old chat');
  const button = sidebar(page).getByRole('button', { name: 'New chat', exact: true });
  const list = await sidebar(page).locator('.list').boundingBox();
  const box = await button.boundingBox();
  expect(box!.y).toBeGreaterThan(list!.y + list!.height - 1);
  await expect(button).toHaveAttribute('title', /New chat \((⌘⇧O|Ctrl Shift O)\)/);

  await expect(button.locator('kbd')).toHaveText([/⌘|Ctrl/, /⇧|Shift/, 'O']);

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+O');
  await expect(page.locator('.chat-title')).toHaveText('New chat');
});

test('the sidebar resizes by drag and keyboard, remembers it, and resets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  const width = async () => Math.round((await sidebar(page).boundingBox())!.width);
  expect(await width()).toBe(300);

  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 63, box.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width()).toBe(360);

  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await width()).toBe(344);
  await page.keyboard.press('End');
  expect(await width()).toBe(420);
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await page.reload();
  expect(await width()).toBe(420);

  await handle.dblclick();
  expect(await width()).toBe(300);
  await handle.focus();
  await page.keyboard.press('Home');
  expect(await width()).toBe(240);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(handle).toHaveCount(0);
});

test('pinned chats reorder from the menu and by dragging the grip', async ({ page }) => {
  await seedChats([{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }]);
  await page.goto('/');
  for (const title of ['Gamma', 'Beta', 'Alpha']) {
    await (await openMenu(page, title)).getByRole('menuitem', { name: 'Pin' }).click();
  }
  await expect(titles(page)).toHaveText(['Alpha', 'Beta', 'Gamma']);

  const menu = await openMenu(page, 'Alpha');
  await expect(menu.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(titles(page)).toHaveText(['Beta', 'Alpha', 'Gamma']);
  await page.reload();
  await expect(titles(page)).toHaveText(['Beta', 'Alpha', 'Gamma']);

  const gamma = sidebar(page).locator('.row', { hasText: 'Gamma' });
  await gamma.hover();
  const grip = (await gamma.locator('.rgrip').boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) await page.mouse.move(x, y - step * 5);
  await page.mouse.up();
  await expect(titles(page)).toHaveText(['Gamma', 'Beta', 'Alpha']);
  await page.reload();
  await expect(titles(page)).toHaveText(['Gamma', 'Beta', 'Alpha']);
});
