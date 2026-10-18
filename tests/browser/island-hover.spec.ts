import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { pointAtScout, scoutBody } from './island-pointer.ts';

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

async function openIsland(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

async function hoverIsland(page: Page) {
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
}

async function leaveIsland(page: Page) {
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
}

test('hovering waits a moment before opening and a moment before closing', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openIsland(page);
  const body = await scoutBody(page);
  await page.mouse.move(body.x, 300);
  await page.mouse.move(body.x, body.y);
  await page.mouse.move(body.x, 300);
  await page.waitForTimeout(400);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  await hoverIsland(page);
  await page.waitForTimeout(800);
  const box = (await island(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');

  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await page.mouse.move(box.x + box.width / 2 + 10, 10);
  await page.waitForTimeout(400);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await leaveIsland(page);
  await hoverIsland(page);

  await island(page)
    .getByRole('tab', { name: /^Chats/ })
    .click();
  await page.mouse.move(5, 600);
  await page.waitForTimeout(800);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});
