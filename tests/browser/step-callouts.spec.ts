import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { chatRepo, linkedChat, send, turnDone, type ChatRepo } from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

const turn = (page: Page) => page.locator('.msg.ai').last();
const row = (page: Page, name: RegExp) => turn(page).getByRole('button', { name });

const ROWS = [
  'Read 2 files',
  'Opened www.cloudzero.com',
  'Read the page',
  'Searched the web for cloud cost pricing tiers',
  'Read 2 files',
  'Made a page: Pricing summary',
  'Chose File › Save in Notes',
];

async function rowStates(page: Page): Promise<string[]> {
  return turn(page)
    .locator('.trows > button.trow')
    .evaluateAll((buttons) =>
      buttons.map(
        (button) =>
          `${button.querySelector('.trow-text')?.textContent ?? ''}:${button.getAttribute('aria-expanded')}`,
      ),
    );
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('.msg.ai')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations;
}

let repo: ChatRepo;

test.beforeEach(() => {
  repo = chatRepo();
});

test.afterEach(() => repo.remove());

test('important steps show as their own rows between the folded groups', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await linkedChat(page, repo);
  await send(page, 'Check the pricing page #callouts');

  const live = row(page, /^In progress Opening www\.cloudzero\.com \d+s$/);
  await expect(live).toBeVisible();
  await expect(live.getByRole('img', { name: 'In progress' })).toBeVisible();
  await expect(row(page, /^Read 2 files/)).toBeVisible();
  await turnDone(page);

  expect(await rowStates(page)).toEqual(ROWS.map((name) => `${name}:false`));

  const opened = row(page, /^Opened www\.cloudzero\.com/);
  expect((await opened.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  await opened.focus();
  await page.keyboard.press('Enter');
  await expect(opened).toHaveAttribute('aria-expanded', 'true');
  const details = turn(page).locator(`[id="${await opened.getAttribute('aria-controls')}"]`);
  await expect(details).toContainText('spark_browser_open');
  await expect(details).toContainText('Done');
  await expect(opened).toBeFocused();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await scan(page)).toEqual([]);
    if (SHOTS) await turn(page).screenshot({ path: `${SHOTS}/step-callouts-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });

  await page.keyboard.press('Space');
  await expect(opened).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toBeHidden();

  await page.reload();
  await expect(row(page, /^Opened www\.cloudzero\.com/)).toBeVisible();
  expect(await rowStates(page)).toEqual(ROWS.map((name) => `${name}:false`));
});

test('a finished turn folds its callouts too and names them in the summary', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, collapseTurns: true });
  await linkedChat(page, repo);
  await send(page, 'Check the pricing page #callouts');
  await turnDone(page);

  const fold = turn(page).getByRole('button', { name: /^Worked/ });
  await expect(fold).toHaveText(
    /^Worked( for \d+s)? · read 4 files, used the browser 2 times, used the web once, made 1 page, acted in Mac apps once$/,
  );
  await expect(row(page, /^Opened www\.cloudzero\.com/)).toBeHidden();
  await expect(turn(page).getByText('The pricing page lists three plans.')).toBeVisible();

  await fold.focus();
  await page.keyboard.press('Enter');
  await expect(row(page, /^Opened www\.cloudzero\.com/)).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await scan(page)).toEqual([]);
    if (SHOTS) await turn(page).screenshot({ path: `${SHOTS}/step-callouts-fold-${scheme}.png` });
  }
});
