import { mkdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  workPanel,
  type CrewRepo,
} from './crew-engine.ts';

const SHOTS = path.join('test-results', 'plan-line');
const REQUEST = 'Split this up: build a store, add an API and add a view. #build #pieces';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('a build saves its plan and says so in one quiet line that opens the plan', async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  await crewChat(page, repo, 'Full auto');
  await send(page, REQUEST);

  const line = page.getByRole('button', { name: 'Plan saved · 3 pieces. Open the plan' });
  await expect(line).toBeVisible({ timeout: 60_000 });
  await expect(line).toHaveText('Plan saved · 3 pieces');
  await expect(page.locator('.plan-line')).toHaveCount(1);
  await expect(card(page, /Build this plan\?/)).toHaveCount(0);
  await expect(card(page, /Approve the plan\?/)).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .include('.plan-line')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `plan-line-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  await line.focus();
  await expect(line).toBeFocused();
  await page.keyboard.press('Enter');
  const agreed = workPanel(page).getByRole('region', { name: 'Agreed plan' });
  await expect(agreed).toBeVisible();
  await expect(agreed).toContainText('Approved');
  await expect(agreed).toContainText('Store: Build the store');
  await expect(workPanel(page).getByRole('tab', { name: 'Plan' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expect(page.locator('.plan-line')).toHaveCount(1);
});
