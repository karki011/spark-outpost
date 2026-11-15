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

  test('the floating rail has 44px targets and leaves Escape to a dialog it opened', async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true, catalog: true });
    await longChat(page, PROMPTS.slice(0, 1));
    await page.setViewportSize(NARROW);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await header(page).getByRole('button', { name: 'Hide work panel' }).click();
    await page.getByRole('button', { name: 'Show context rail' }).click();
    await expect(rail(page)).toBeVisible();
    const manage = rail(page).getByRole('button', { name: 'Manage tools' });
    const connect = rail(page).getByRole('button', { name: 'Connect…' });
    for (const target of [manage, connect]) {
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }

    await manage.click();
    const settings = page.getByRole('dialog').first();
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(rail(page)).toBeVisible();
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

  test('Escape closes the floating rail and leaves the turn running', async ({ page }) => {
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
    } finally {
      writeFileSync(gate, '');
    }
    await expect(stopButton(page)).toHaveCount(0, { timeout: 120_000 });
    await expect(turns(page).last()).toContainText('Rail escape finished.');
    await expect(turns(page).last()).not.toContainText(/Stopped/);
  });
});
