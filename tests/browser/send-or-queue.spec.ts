import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  BUILD_REQUEST,
  card,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
} from './project-chat-kit.ts';

const SHOTS = process.env.SEND_OR_QUEUE_SHOTS ?? '';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const queued = (page: Page) =>
  page.getByRole('list', { name: 'Queued messages' }).getByRole('listitem');
const mine = (page: Page) => page.locator('.msg.me');
const hint = (page: Page) => page.locator('.comp-bar .hint');
const caret = (page: Page) => page.getByRole('button', { name: 'Choose message timing' });
const menu = (page: Page) => page.getByRole('menu', { name: 'Queue or send now' });
const notice = (page: Page) => page.locator('.composer-notice[role="status"]:not(:empty)');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `send-or-queue-${name}.png`) });
}

async function otherKey(page: Page): Promise<string> {
  const mac = await page.evaluate(() => navigator.platform.startsWith('Mac'));
  return mac ? '⌘Enter' : 'Ctrl+Enter';
}

async function waitingCrew(page: Page) {
  await projectChat(page, repo, 'Ask before edits');
  await send(page, `${BUILD_REQUEST} #build`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
}

async function noAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

async function setBusyEnter(page: Page, choice: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const group = page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('radiogroup', { name: 'While the agent is working, Enter' });
  await group.scrollIntoViewIfNeeded();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await group.getByRole('radio', { name: choice }).click();
  await saved;
  await expect(group.getByRole('radio', { name: choice })).toBeChecked();
  return group;
}

test('Enter queues and ⌘Enter sends now while a turn runs, ahead of the queue @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await waitingCrew(page);
  const other = await otherKey(page);
  await composer(page).focus();
  await expect(hint(page)).toHaveText(`Enter to queue · ${other} to send now`);
  await expect(page.getByRole('button', { name: 'Queue message' })).toHaveAttribute(
    'title',
    'Queue: sends when this turn ends (Enter)',
  );
  await shot(page, 'hint');

  await composer(page).fill('Later please');
  await composer(page).press('Enter');
  await expect(queued(page)).toHaveText([/Later please/]);

  await composer(page).fill('Do this now');
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/queue/send-now') && response.status() === 202,
  );
  await composer(page).press('ControlOrMeta+Enter');
  expect((await (await sent).json()).outcome).toBe('steering');
  await expect(composer(page)).toHaveValue('');
  await expect(queued(page)).toHaveText([/Later please/]);
  await expect(notice(page)).toHaveText('Stopped the turn to send your message', {
    timeout: 30_000,
  });
  await expect(mine(page).filter({ hasText: 'Do this now' })).toBeVisible();
  await expect(page.locator('.msg.ai').first()).toContainText('Stopped before finishing.');
  await expect(queued(page)).toHaveText([/Later please/]);
  await shot(page, 'stopped-to-send');
});

test('the split send button offers both actions by mouse and keyboard', async ({ page }) => {
  test.setTimeout(120_000);
  await waitingCrew(page);
  const other = await otherKey(page);
  const main = page.getByRole('button', { name: 'Queue message' });
  await expect(main).toBeDisabled();

  await caret(page).click();
  await expect(caret(page)).toHaveAttribute('aria-expanded', 'true');
  const items = menu(page).getByRole('menuitem');
  await expect(items).toHaveText([
    new RegExp(`^Queue\\s*Sends when this turn ends\\s*Enter$`),
    new RegExp(`^Send now\\s*Steers or interrupts the turn\\s*${other.replace('+', '\\+')}$`),
  ]);
  await expect(items.nth(0)).toBeFocused();
  await expect(items.nth(0)).toHaveAttribute('aria-disabled', 'true');
  await expect(menu(page)).toContainText('Type a message first.');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(caret(page)).toBeFocused();

  await composer(page).fill('Queued by keyboard');
  await caret(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(1)).toBeFocused();
  await noAxeViolations(page, '.composer');
  await shot(page, 'menu');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(queued(page)).toHaveText([/Queued by keyboard/]);
  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveValue('');

  await page.setViewportSize({ width: 420, height: 800 });
  await composer(page).fill('From the menu');
  await expect(main).toBeVisible();
  await caret(page).click();
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);
  await shot(page, 'menu-narrow');
  await items.nth(1).click();
  await expect(menu(page)).toBeHidden();
  await expect(composer(page)).toHaveValue('');
  await expect(mine(page).filter({ hasText: 'From the menu' })).toBeVisible({ timeout: 30_000 });
  await expect(queued(page)).toHaveText([/Queued by keyboard/]);
});

test('the Enter setting flips the default, the button and the hint', async ({ page }) => {
  test.setTimeout(120_000);
  await waitingCrew(page);
  const other = await otherKey(page);
  const group = await setBusyEnter(page, 'Sends it now');
  await expect(group).toHaveAccessibleDescription(
    `The agent reads it mid-turn, or the turn stops and your message goes first. ${other} queues it instead.`,
  );
  await noAxeViolations(page, '.seg');
  await shot(page, 'setting');
  await page.keyboard.press('Escape');
  expect((await (await page.request.get('/api/setup')).json()).profile.busyEnter).toBe('now');

  await composer(page).focus();
  await expect(hint(page)).toHaveText(`Enter to send now · ${other} to queue`);
  await expect(composer(page)).toHaveAttribute('placeholder', 'Send a message to the running turn');
  const main = page.getByRole('button', { name: 'Send now', exact: true });
  await expect(main).toHaveAttribute('title', 'Send now: steers or interrupts the turn (Enter)');
  await caret(page).click();
  await expect(menu(page).getByRole('menuitem').nth(0)).toContainText(other);
  await expect(menu(page).getByRole('menuitem').nth(1)).toContainText(/Enter$/);
  await shot(page, 'setting-flipped');
  await page.keyboard.press('Escape');

  await composer(page).fill('Queued with the other key');
  await composer(page).press('ControlOrMeta+Enter');
  await expect(queued(page)).toHaveText([/Queued with the other key/]);

  await composer(page).fill('Sent with Enter');
  await composer(page).press('Enter');
  await expect(mine(page).filter({ hasText: 'Sent with Enter' })).toBeVisible({ timeout: 30_000 });
  await expect(queued(page)).toHaveText([/Queued with the other key/]);
});

test('a failed Send now keeps the draft and shows the error', async ({ page }) => {
  test.setTimeout(90_000);
  await waitingCrew(page);
  await page.route('**/queue/send-now', (route) =>
    route.fulfill({ status: 500, json: { error: 'Could not send that message.' } }),
  );
  await composer(page).fill('Keep me');
  await composer(page).press('ControlOrMeta+Enter');
  await expect(page.locator('.composer-error[role="alert"]')).toHaveText(
    'Could not send that message.',
  );
  await expect(composer(page)).toHaveValue('Keep me');
  await expect(queued(page)).toHaveCount(0);
  await expect(mine(page).filter({ hasText: 'Keep me' })).toHaveCount(0);
});
