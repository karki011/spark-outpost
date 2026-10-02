import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-island-projects-')));
  for (const name of ['shop-app', 'docs-site', 'picked-repo']) mkdirSync(path.join(base, name));
});

test.afterAll(() => rmSync(base, { recursive: true, force: true }));

const island = (page: Page) => page.getByRole('region', { name: 'Spark companion' });

async function link(page: Page, name: string) {
  const response = await page.request.post('/api/projects', {
    data: { rootPath: path.join(base, name) },
  });
  expect(response.ok()).toBe(true);
}

async function openQuickChat(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('Alt+Space');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
}

async function expectInside(page: Page, selector: string) {
  await page.waitForTimeout(700);
  const frame = (await island(page).boundingBox())!;
  const box = (await island(page).locator(selector).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(frame.x);
  expect(box.y).toBeGreaterThanOrEqual(frame.y);
  expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
}

for (const width of [420, 1280]) {
  test(`Quick chat lists linked projects and starts the chat in the one picked (${width}px)`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await link(page, 'shop-app');
    await link(page, 'docs-site');
    await openQuickChat(page, width);
    await island(page).getByRole('button', { name: 'Choose project' }).click();
    const menu = island(page).getByRole('menu', { name: 'Choose project' });
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      /docs-site/,
      /shop-app/,
      /No project/,
    ]);
    await expect(menu.getByRole('menuitem', { name: 'Add a project…' })).toBeVisible();
    await expectInside(page, '.isl-menu');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: /shop-app/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(island(page).getByRole('button', { name: 'shop-app' })).toBeVisible();

    const message = island(page).getByRole('textbox', { name: 'Message' });
    await message.fill('Tidy the checkout page');
    await page.keyboard.press('Enter');
    await expect(message).toHaveCount(0);
    await expect
      .poll(async () => {
        const chats = (await (await page.request.get('/api/conversations')).json()) as {
          title: string;
          projectIds: string[];
        }[];
        return chats.find((chat) => chat.title.startsWith('Tidy the checkout'))?.projectIds.length;
      })
      .toBe(1);
  });
}

test('with no projects the menu says so and Add a project links a folder and selects it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openQuickChat(page);
  await island(page).getByRole('button', { name: 'Choose project' }).click();
  const menu = island(page).getByRole('menu', { name: 'Choose project' });
  await expect(menu).toContainText('No projects yet');
  await menu.getByRole('menuitem', { name: 'Add a project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a project folder' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('navigation', { name: 'Folder path' }).getByRole('button').first().click();
  for (const segment of path.join(base, 'picked-repo').split('/').filter(Boolean)) {
    await dialog
      .getByRole('list', { name: 'Folders' })
      .getByRole('button', { name: segment, exact: true })
      .click();
  }
  await dialog.getByRole('button', { name: 'Use this folder' }).click();
  await expect(dialog).toBeHidden();
  await expect(island(page).getByRole('button', { name: 'picked-repo' })).toBeVisible();
});

test('in the desktop app Add a project uses the native folder picker', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const folder = path.join(base, 'docs-site');
  await page.addInitScript((folder) => {
    const none = () => () => undefined;
    Object.assign(window, {
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: none },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: (callback: (action: string) => void) => {
            Object.assign(window, { islandCommand: callback });
            return () => undefined;
          },
          onEscape: none,
          sparkFocused: async () => true,
          onSparkFocus: none,
          pickFolder: async () => folder,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  }, folder);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { islandCommand: (action: string) => void }).islandCommand('quick'),
  );
  await island(page).getByRole('button', { name: 'Choose project' }).click();
  await island(page).getByRole('menuitem', { name: 'Add a project…' }).click();
  await expect(island(page).getByRole('button', { name: 'docs-site' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Choose a project folder' })).toHaveCount(0);
});
