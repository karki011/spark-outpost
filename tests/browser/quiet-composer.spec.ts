import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { chatRepo, linkedChat, send, turnDone, type ChatRepo } from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

const foot = (page: Page) => page.locator('.comp-foot');
const bar = (page: Page) => page.locator('.comp-bar');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('.composer-wrap').screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
}

let repo: ChatRepo;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  repo = chatRepo();
});

test.afterEach(() => repo.remove());

test('the footer under the box holds the project, the session type and the mode', async ({
  page,
}) => {
  await linkedChat(page, repo);
  const name = path.basename(repo.root);
  await expect(foot(page).getByRole('button', { name: `Project folders: ${name}` })).toBeVisible();
  await expect(
    foot(page).getByRole('button', { name: 'Where this chat works: New branch' }),
  ).toBeVisible();
  await expect(foot(page).getByRole('button', { name: 'Session type: Chat' })).toBeVisible();
  await expect(foot(page).getByRole('button', { name: /^Permissions: / })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: /^Permissions: / })).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: /^Project folders/ })).toHaveCount(0);

  const footBox = await foot(page).boundingBox();
  const boxBox = await page.locator('.composer').boundingBox();
  expect(footBox!.y).toBeGreaterThanOrEqual(boxBox!.y + boxBox!.height);
  const chips = foot(page).locator(
    ':is(.ctx-repo, .ctx-place, .ctx-details, .session-chip, .pchip)',
  );
  await expect(chips).toHaveCount(5);
  for (const control of await chips.all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  }

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await expect(bar(page)).not.toContainText('Enter to send');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    /^Ask anything\. @ for files/,
  );
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello');
  await expect(bar(page).getByRole('button', { name: 'Send' })).toHaveAttribute(
    'title',
    'Enter to send, Shift + Enter for a new line',
  );
  await page.getByRole('textbox', { name: 'Message' }).fill('');
  await shot(page, 'composer-new-chat');
});

test('the mode chip in the footer opens and closes the permissions picker', async ({ page }) => {
  await linkedChat(page, repo);
  const chip = foot(page).getByRole('button', { name: /^Permissions: / });
  await chip.click();
  const picker = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('tab', { name: /Permissions/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await chip.click();
  await expect(picker).toBeHidden();
  await chip.click();
  await expect(picker.getByRole('tab', { name: /Permissions/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(chip).toBeFocused();
});

test('the session chip switches a new chat to a Terminal session and back', async ({ page }) => {
  await linkedChat(page, repo);
  const chip = foot(page).getByRole('button', { name: 'Session type: Chat' });
  await chip.click();
  const menu = page.getByRole('menu', { name: 'Session type' });
  await expect(menu.getByRole('menuitemradio', { name: /^Chat/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Work in your terminal' })).toBeVisible();
  const terminalChip = foot(page).getByRole('button', { name: 'Session type: Terminal' });
  await expect(terminalChip).toBeVisible();
  await terminalChip.click();
  await menu.getByRole('menuitemradio', { name: /^Chat/ }).click();
  await expect(foot(page).getByRole('button', { name: 'Session type: Chat' })).toBeVisible();
});

test('the context reading shows in the footer only past half the window', async ({ page }) => {
  await linkedChat(page, repo);
  await send(page, 'Plan the rollout #ctx13 #window1m');
  await turnDone(page);
  await expect(page.getByRole('button', { name: /^Context window/ })).toHaveCount(0);

  await send(page, 'Plan the rollout #ctx62 #window1m');
  await turnDone(page);
  const ring = foot(page).getByRole('button', { name: /^Context window: 62% used/ });
  await expect(ring).toHaveText('62% context');
  await page.getByRole('textbox', { name: 'Message' }).fill('Also add it to the reports page');
  await shot(page, 'composer-follow-up');
  await ring.click();
  await expect(page.getByRole('dialog', { name: 'Context window' })).toBeVisible();
});

test('a chat with no project explains the empty project chip', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const chip = foot(page).getByRole('button', { name: 'Choose project' });
  await expect(chip).toHaveAttribute('aria-description', 'Pick a project to work in your code.');
});
