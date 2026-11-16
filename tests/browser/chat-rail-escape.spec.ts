import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  BUILD_REQUEST,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { PROMPTS, header, longChat, rail, turns } from './chat-rail-kit.ts';

const NARROW = { width: 1280, height: 900 };
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('the floating rail and its Tools list have 44px targets', async ({ page }) => {
    await resetTestDatabase({ onboarded: true, catalog: true });
    await longChat(page, PROMPTS.slice(0, 1));
    await page.setViewportSize(NARROW);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await header(page).getByRole('button', { name: 'Hide work panel' }).click();
    await page.getByRole('button', { name: 'Show context rail' }).click();
    await expect(rail(page)).toBeVisible();
    const section = rail(page).getByRole('region', { name: 'Tools' });
    const tools = section.getByRole('button', { name: /^Tools/ });
    await tools.scrollIntoViewIfNeeded();
    const box = (await tools.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);

    const connect = section.getByRole('button', { name: 'Connect…' });
    await connect.scrollIntoViewIfNeeded();
    const connectBox = (await connect.boundingBox())!;
    expect(connectBox.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(rail(page)).toHaveCount(0);
  });
});

test.describe('a running turn', () => {
  let repo: ChatRepo | null = null;

  test.afterEach(() => {
    repo?.remove();
    repo = null;
  });

  test('Escape closes the floating rail and chat list and leaves the turn running', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await resetWithAgents();
    repo = chatRepo();
    await page.setViewportSize(NARROW);
    await projectChat(page, repo, 'Full auto');
    await send(page, `${BUILD_REQUEST} #build`);
    await turnDone(page);
    const gate = `${repo.root}/.git/rail-escape-release`;
    const script = JSON.stringify([
      { say: 'Working on the notes.' },
      { waitFor: gate },
      { say: 'Rail escape finished.' },
    ]);
    try {
      await send(page, `${BUILD_REQUEST} #build #sparkscript ${script}`);
      await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });
      const hide = header(page).getByRole('button', { name: 'Hide work panel' });
      if (await hide.isVisible()) await hide.click();
      const show = page.getByRole('button', { name: 'Show context rail' });
      await show.click();
      await expect(rail(page)).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(rail(page)).toHaveCount(0);
      await expect(show).toBeFocused();
      await expect(stopButton(page)).toBeVisible();

      await page.setViewportSize({ width: 760, height: 900 });
      await page.getByRole('button', { name: 'Show sidebar' }).click();
      const sidebar = page.locator('nav.side');
      await expect(sidebar).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
      await expect(stopButton(page)).toBeVisible();
    } finally {
      writeFileSync(gate, '');
    }
    await expect(stopButton(page)).toHaveCount(0, { timeout: 120_000 });
    await expect(turns(page).last()).toContainText('Rail escape finished.');
    await expect(turns(page).last()).not.toContainText(/Stopped/);
  });
});
