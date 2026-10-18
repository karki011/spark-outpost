import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

const FILLER = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
const QUESTION = [
  `Which provider did the most work this week? ${FILLER}`,
  '- **Claude** is your `default` model',
  '- read [the guide](https://example.com/guide)',
].join('\n');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({
    path: path.join(SHOTS, `island-ask-${name}.png`),
    clip: { x: 300, y: 0, width: 680, height: 420 },
  });
}

async function askLongQuestion(page: Page) {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('Alt+Space');
  await page.keyboard.press('Meta+4');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  await ask.fill(QUESTION);
  await page.clock.pauseAt(Date.now() + 1_000);
  await page.keyboard.press('Enter');
  return island(page).locator('.isl-thinking');
}

test('Ask shows a playful looking scene, cycles its lines, then renders the answer as Markdown', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const thinking = await askLongQuestion(page);
  await expect(thinking).toContainText('Spark is looking…');
  await expect(thinking.locator('.isl-glass')).not.toHaveCSS('animation-name', 'none');
  await expect(thinking.locator('svg.scout')).toHaveClass(/\bworking\b/);
  await shot(page, 'looking');
  await page.clock.runFor(2_500);
  await expect(thinking).not.toContainText('Spark is looking…');
  await shot(page, 'looking-next');
  await page.clock.runFor(2_500);
  await expect(thinking).toContainText('Almost there');
  await page.clock.resume();

  const answer = island(page).locator('.isl-ask-a').last();
  await expect(answer.locator('li')).toHaveCount(2, { timeout: 20_000 });
  await expect(answer.locator('strong')).toHaveText('Claude');
  await expect(answer.locator('code')).toHaveText('default');
  const link = answer.getByRole('link', { name: 'the guide' });
  await expect(link).toHaveAttribute('href', 'https://example.com/guide');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(answer).not.toContainText('**');
  await expect(thinking).toHaveCount(0);
  await shot(page, 'answer');
});

test('Ask keeps the scene still with reduced motion and only changes the words', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const thinking = await askLongQuestion(page);
  await expect(thinking).toContainText('Spark is looking…');
  await expect(thinking.locator('.isl-glass')).toHaveCSS('animation-name', 'none');
  await expect(thinking.locator('.sc-look')).toHaveCSS('animation-name', 'none');
  await page.clock.runFor(2_500);
  await expect(thinking).not.toContainText('Spark is looking…');
  await expect(thinking).toHaveCSS('animation-name', 'none');
});
