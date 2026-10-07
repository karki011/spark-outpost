import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { autoContinueAfter, crewChat, crewRepo, resetCrew, send } from './crew-engine.ts';

const SHOTS = process.env.ASK_CARD_SHOTS ?? '';
const SIZES = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 375, height: 812 },
} as const;
const CASES = [
  { name: 'one', request: 'Make the reports better #build #vague #questions' },
  { name: 'three', request: 'Tell me anything about this repo #build #vague #questions #three' },
  { name: 'long', request: 'Split the reports page #build #vague #questions #longoptions' },
];

const askCard = (page: Page) => page.locator('.thread .appr.ck.clarify').last();

async function shots(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  for (const [size, viewport] of Object.entries(SIZES)) {
    await page.setViewportSize(viewport);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      await expect(async () => {
        await askCard(page).scrollIntoViewIfNeeded({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await page.screenshot({ path: path.join(SHOTS, `${name}-${size}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(SIZES.desktop);
  await page.waitForTimeout(500);
}

async function answer(page: Page, name: string) {
  const card = askCard(page);
  await card.locator('.ask-opt').nth(1).click();
  await card.getByRole('textbox').first().fill('and keep the export button');
  if (await card.locator('.ask-line[aria-expanded]').count()) {
    await card.locator('.ask-line[aria-expanded]').first().click();
    await expect(card.getByRole('group', { name: 'Question 2 of 3' })).toBeVisible();
    await shots(page, `${name}-second`);
  }
  await card.getByRole('button', { name: 'Send' }).click();
}

test.describe('ask card screenshots', () => {
  test.skip(!SHOTS, 'set ASK_CARD_SHOTS to an output folder');

  for (const { name, request } of CASES) {
    test(`${name}: pending and answered`, async ({ page }) => {
      test.setTimeout(180_000);
      await resetCrew();
      const repo = crewRepo();
      try {
        await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
        await page.setViewportSize(SIZES.desktop);
        await autoContinueAfter(page, null);
        await crewChat(page, repo, 'Auto-edit');
        await send(page, request);
        await expect(askCard(page)).toBeVisible({ timeout: 30_000 });
        await shots(page, `${name}-pending`);
        await answer(page, name);
        await expect(askCard(page).getByRole('status')).toContainText('Answered.');
        await shots(page, `${name}-answered`);
      } finally {
        repo.remove();
      }
    });
  }
});
