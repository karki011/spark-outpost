import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { pickPermission } from './permissions-kit.ts';
import { chatRepo, turnDone, type ChatRepo } from './project-chat-kit.ts';
import { animationsSettled } from './settle.ts';
import { seedChats } from './sidebar-seed.ts';

test.describe.configure({ timeout: 90_000 });

const REVIEW_SHOTS = process.env.REVIEW_SHOTS ?? '';
const LONG_TITLE = 'Check parallel fetching in the browser pane before the release notes go out';
const WIDTHS = [900, 1280, 1680, 'tight'] as const;
const TIGHT_COLUMN = '.main { --chat-col: 300px !important; }';

async function useTheme(page: Page, theme: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
}

async function shoot(target: Locator, name: string) {
  if (REVIEW_SHOTS) await target.screenshot({ path: path.join(REVIEW_SHOTS, `${name}.png`) });
}

async function contrastViolations(page: Page, selector: string) {
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withRules(['color-contrast'])
    .setLegacyMode(true)
    .analyze();
  return results.violations.map((violation) => violation.nodes.map((node) => node.target));
}

function overflowOf(element: Locator) {
  return element.evaluate((node) => node.scrollWidth - node.clientWidth);
}

test('the undo toast keeps its message readable above a thin time-left bar', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: LONG_TITLE }, { title: 'Second chat' }]);
  await page.setViewportSize({ width: 900, height: 760 });
  await openChats(page);
  const nav = page.getByRole('navigation', { name: 'Chats' });
  const row = nav.getByRole('listitem').filter({ hasText: LONG_TITLE });
  await row.hover();
  await nav.getByRole('button', { name: `Options for ${LONG_TITLE}` }).click();
  await page
    .getByRole('menu', { name: `Options for ${LONG_TITLE}` })
    .getByRole('menuitem', { name: 'Archive' })
    .click();

  const toast = nav.getByRole('status').filter({ hasText: `Archived ${LONG_TITLE}` });
  await expect(toast).toBeVisible();
  await toast.hover();
  for (const theme of ['apricot', 'graphite']) {
    await useTheme(page, theme);
    await shoot(toast.locator('xpath=..'), `toast-${theme}`);
  }
  const text = toast.locator('.toast-text');
  const timer = toast.locator('.toast-timer');
  await expect(text).toHaveAttribute('title', `Archived ${LONG_TITLE}`);

  for (const theme of ['light', 'apricot', 'graphite']) {
    await useTheme(page, theme);
    const box = await toast.boundingBox();
    const bar = await timer.boundingBox();
    const message = await text.boundingBox();
    expect(bar!.height).toBeLessThanOrEqual(3);
    expect(bar!.y + bar!.height).toBeCloseTo(box!.y + box!.height, 0);
    expect(message!.y + message!.height).toBeLessThanOrEqual(bar!.y);
    expect(await timer.evaluate((node) => getComputedStyle(node).animationPlayState)).toBe(
      'paused',
    );
    expect(await contrastViolations(page, '.toasts')).toEqual([]);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await timer.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeVisible();
});

async function chatOnItsBranch(page: Page, repo: ChatRepo) {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  await page
    .getByRole('dialog', { name: 'Project folders' })
    .getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) })
    .click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await turnDone(page, 20_000);
}

test('the context bar chips never overlap at narrow, typical and wide windows', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  const repo = chatRepo();
  try {
    await page.setViewportSize({ width: 1280, height: 860 });
    await chatOnItsBranch(page, repo);
    const bar = page.locator('.ctxbar');
    const branch = bar.locator('.chat-branch');
    const autonomy = bar.locator('.ctx-autonomy');
    await expect(branch).toContainText('· worktree');
    await expect(autonomy).toBeVisible();
    await autonomy.click();
    await expect(page.locator('#work-panel')).toBeVisible();

    for (const width of WIDTHS) {
      if (width === 'tight') await page.addStyleTag({ content: TIGHT_COLUMN });
      else await page.setViewportSize({ width, height: 860 });
      await animationsSettled(page);
      for (const theme of ['apricot', 'graphite']) {
        await useTheme(page, theme);
        await shoot(bar, `context-bar-${width}-${theme}`);
      }
      expect(await overflowOf(bar)).toBeLessThanOrEqual(0);
      expect(await overflowOf(branch)).toBeLessThanOrEqual(0);
      const kind = await branch.locator('.chat-branch-kind').boundingBox();
      const chip = await autonomy.boundingBox();
      expect(kind!.x + kind!.width).toBeLessThanOrEqual(chip!.x);
      await expect(autonomy.locator('.ctx-autonomy-name')).toHaveText(/Full auto → PR|Automatic/);
      for (const theme of ['light', 'graphite']) {
        await useTheme(page, theme);
        expect(await contrastViolations(page, '.ctxbar')).toEqual([]);
      }
    }
  } finally {
    repo.remove();
  }
});
