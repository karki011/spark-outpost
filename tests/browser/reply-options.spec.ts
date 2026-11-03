import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { storeReply } from '../../apps/server/test/stored-crew-turn.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = process.env.SPARK_SHOTS;
const OFFER =
  'The parser now handles empty files.\n\nWhat would you like next?\n\n- Add tests for the parser\n- **Open** a pull request\n- Leave it as it is';
const OLD_OFFER = 'Which store should I use?\n\n- Postgres\n- SQLite';
const STEPS = 'To try it:\n\n1. Open Settings\n2. Pick a provider';

async function seedChat(replies: readonly string[]): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const start = Date.now() - 10 * 60_000;
    for (const [index, reply] of replies.entries()) {
      const runId = await seedTurn(db, conversationId, {
        request: `Request ${index + 1}`,
        createdAt: new Date(start + index * 60_000),
      });
      await storeReply(db, runId, reply);
    }
  } finally {
    await db.end();
  }
}

async function openSeededChat(page: Page): Promise<void> {
  await openChats(page);
  await page.getByText('Outcomes').first().click();
  await expect(page.locator('.mood', { hasText: 'done' }).last()).toBeAttached({
    timeout: 15_000,
  });
}

const options = (page: Page) => page.getByRole('group', { name: 'Reply options' });
const messageBox = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected text' });
const listItem = (page: Page) => page.locator('.md li', { hasText: 'Leave it as it is' });
const highlightCount = (page: Page) =>
  page.evaluate(() => CSS.highlights.get('spark-quote-note')?.size ?? 0);

async function comment(page: Page, root: Locator, needle: string, note: string) {
  await root.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.nodeValue?.indexOf(text) ?? -1;
      if (at >= 0) {
        window.getSelection()!.setBaseAndExtent(node, at, node, at + text.length);
        return;
      }
    }
    throw new Error(`Text not found: ${text}`);
  }, needle);
  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  const box = toolbar(page).getByRole('textbox', { name: 'Comment on the selected text' });
  await box.fill(note);
  await box.press('Enter');
  await expect(toolbar(page)).toBeHidden();
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a closing list of choices folds into buttons that only fill the message box', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedChat([OLD_OFFER, OFFER]);
  await openSeededChat(page);

  await expect(options(page)).toHaveCount(1);
  const group = options(page);
  await expect(group).toHaveAccessibleDescription(/Nothing is sent until you press Enter/);
  await expect(group.getByRole('button')).toHaveText([
    'Add tests for the parser',
    'Open a pull request',
    'Leave it as it is',
  ]);
  await expect(page.getByText('What would you like next?')).toBeVisible();
  await expect(listItem(page)).toHaveCount(0);
  await expect(page.locator('.md li', { hasText: 'SQLite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Postgres' })).toHaveCount(0);

  const turns = await page.locator('.msg.ai').count();
  await group.getByRole('button', { name: 'Open a pull request' }).click();
  await expect(messageBox(page)).toBeFocused();
  await expect(messageBox(page)).toHaveValue('Open a pull request');

  await group.getByRole('button', { name: 'Leave it as it is' }).click();
  await expect(messageBox(page)).toHaveValue('Leave it as it is');
  await expect(page.locator('.msg.ai')).toHaveCount(turns);
  await expect(page.locator('.msg.user', { hasText: 'Leave it as it is' })).toHaveCount(0);

  await messageBox(page).fill('Thanks, and');
  await group.getByRole('button', { name: 'Add tests for the parser' }).focus();
  await page.keyboard.press('Enter');
  await expect(messageBox(page)).toBeFocused();
  await expect(messageBox(page)).toHaveValue('Thanks, and\n\nAdd tests for the parser');

  const sizes = await group
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);

  const last = page.locator('.msg.ai').last();
  await last.getByRole('button', { name: 'Copy reply' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '- **Open** a pull request',
  );
});

test('Show as list swaps the buttons back to the list, keeps it per turn, and quotes still work', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedChat([OFFER]);
  await openSeededChat(page);
  await messageBox(page).blur();

  const toggle = page.getByRole('button', { name: 'Show as list' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(listItem(page)).toBeVisible();
  await expect(options(page)).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Show as buttons' });
  await expect(back).toBeFocused();

  await comment(page, listItem(page), 'Leave it', 'Maybe later');
  await expect.poll(() => highlightCount(page)).toBe(1);

  await back.click();
  await expect(options(page)).toBeVisible();
  await expect(listItem(page)).toHaveCount(0);
  await expect.poll(() => highlightCount(page)).toBe(0);

  const lead = page.locator('.md', { hasText: 'What would you like next?' });
  await comment(page, lead, 'handles empty files', 'Nice');
  await expect.poll(() => highlightCount(page)).toBe(1);

  await page.getByRole('button', { name: 'Show as list' }).click();
  await expect.poll(() => highlightCount(page)).toBe(2);
  const main = page.getByRole('navigation', { name: 'Main' });
  await main.getByRole('button', { name: /^Home/ }).click();
  await main.getByRole('button', { name: /^Chats/ }).click();
  await page.getByText('Outcomes').first().click();
  await expect(listItem(page)).toBeVisible();
  await page.getByRole('button', { name: 'Show as buttons' }).click();
  await expect(options(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('other closing lists stay plain text', async ({ page }) => {
  await seedChat([STEPS]);
  await openSeededChat(page);
  await expect(page.locator('.md li', { hasText: 'Pick a provider' })).toBeVisible();
  await expect(options(page)).toHaveCount(0);
});

test('choices fit a phone and pass axe in light and dark', async ({ page }) => {
  await seedChat([OFFER]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSeededChat(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(options(page)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await options(page).boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
  await options(page).getByRole('button', { name: 'Leave it as it is' }).click();
  await expect(messageBox(page)).toBeFocused();
  await expect(messageBox(page)).toHaveValue('Leave it as it is');
  await messageBox(page).blur();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(() => delete document.documentElement.dataset.skin);
    await animationsSettled(page);
    const results = await new AxeBuilder({ page })
      .include('.reply-options')
      .include('.reply-options-toggle')
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    if (SHOTS) {
      await page
        .locator('.msg.ai')
        .last()
        .screenshot({ path: `${SHOTS}/reply-options-phone-${scheme}.png` });
    }
  }

  if (SHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await animationsSettled(page);
      await page
        .locator('.msg.ai')
        .last()
        .screenshot({ path: `${SHOTS}/reply-options-${scheme}.png` });
    }
  }
});
