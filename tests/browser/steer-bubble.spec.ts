import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  agentBlock,
  card,
  CREW_REQUEST,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.STEER_BUBBLE_SHOTS ?? '';
const HELD_MS = 2_500;

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const mine = (page: Page, text: string) => page.locator('.msg.me').filter({ hasText: text });
const steered = (page: Page, text: string) =>
  page.locator('.msg.me.steered').filter({ hasText: text });
const pendingEdit = (page: Page) =>
  card(page, /Change a file\?/).filter({ has: page.getByRole('button', { name: 'Deny' }) });
const jump = (page: Page) => page.getByRole('button', { name: 'Jump to latest' });
const gap = (page: Page) =>
  page
    .locator('.thread')
    .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);

async function waitingCrew(page: Page, request = CREW_REQUEST) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, `${request} #build #crew`);
  await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
}

async function fixRoundAfterFoldedAgents(page: Page) {
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Fix the divider #build #crew #bugreview');
  await expect(pendingEdit(page)).toBeVisible({ timeout: 30_000 });
  await pendingEdit(page).getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.crew-turn .agent-block.folded').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(pendingEdit(page)).toBeVisible({ timeout: 30_000 });
}

async function builderName(page: Page): Promise<string> {
  const head = page
    .locator('.crew-turn .agent-head, .crew-turn .agent-fold')
    .filter({ has: page.locator('.agent-role', { hasText: /^Builder$/ }) })
    .first()
    .locator('.agent-name');
  return (await head.textContent())!.trim();
}

async function holdSendNow(page: Page) {
  await page.route('**/queue/send-now', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, HELD_MS));
    await route.continue();
  });
}

async function messageBuilder(page: Page, name: string, text: string) {
  await agentBlock(page, name)
    .getByRole('button', { name: `Message ${name}` })
    .click();
  const dialog = page.getByRole('dialog', { name: `Message ${name}` });
  await dialog.getByRole('textbox', { name: `Message to ${name}` }).fill(text);
  await dialog.getByRole('button', { name: `Send to ${name}` }).click();
  await expect(dialog.getByRole('list', { name: `Your messages to ${name}` })).toContainText(text);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

async function setSkin(page: Page, skin: string | null) {
  await page.evaluate((id) => {
    if (id) document.documentElement.dataset.skin = id;
    else delete document.documentElement.dataset.skin;
  }, skin);
}

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  const saved = await page.evaluate(() => document.documentElement.dataset.skin ?? null);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await setSkin(page, scheme === 'dark' ? 'graphite' : null);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
  }
  await setSkin(page, saved);
}

test('a message sent now in a crew turn shows in the thread at once, then once as the next message @packaged', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await fixRoundAfterFoldedAgents(page);
  const name = await builderName(page);
  await holdSendNow(page);

  await composer(page).fill('Use UTC everywhere');
  await composer(page).press('ControlOrMeta+Enter');
  const bubble = steered(page, 'Use UTC everywhere');
  await expect(bubble).toBeVisible({ timeout: HELD_MS - 500 });
  await expect(bubble.getByRole('status')).toHaveText(`${name} reads this at its next step`);
  await expect(bubble.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  await expect(bubble).toBeInViewport();
  await expect(composer(page)).toBeFocused();
  await expect(composer(page)).toHaveValue('');
  expect(
    await bubble.evaluate((element) => {
      const blocks = [...(element.parentElement?.querySelectorAll(':scope > .agent-block') ?? [])];
      const after = Node.DOCUMENT_POSITION_FOLLOWING;
      return blocks.map((block) => Boolean(block.compareDocumentPosition(element) & after));
    }),
  ).not.toContain(false);
  await expect(page.locator('.crew-turn .agent-block').getByText('You →')).toHaveCount(0);
  const axe = await new AxeBuilder({ page })
    .include('.msg.me.steered')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  await shots(page, 'crew-send-now');

  await expect(page.locator('.crew-turn').first()).toContainText('Stopped', { timeout: 30_000 });
  await expect(page.locator('section[data-turn]')).toHaveCount(2, { timeout: 30_000 });
  await expect(steered(page, 'Use UTC everywhere')).toHaveCount(0);
  await expect(mine(page, 'Use UTC everywhere')).toHaveCount(1);
  await expect(page.locator('section[data-turn]').nth(1).locator('.msg.me').first()).toContainText(
    'Use UTC everywhere',
  );
});

test('a message to one crew member shows in the thread and its status follows delivery without pulling a scrolled-up reader down', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 620 });
  await waitingCrew(page, `${'Some background on the repo first. '.repeat(40)}${CREW_REQUEST}`);
  const name = await builderName(page);
  await messageBuilder(page, name, 'Also log the date you parse.');

  const bubble = steered(page, 'Also log the date you parse.');
  await expect(bubble.getByRole('status')).toHaveText(`${name} reads this at its next step`);
  await expect(agentBlock(page, name).getByText('You →')).toHaveCount(0);
  await shots(page, 'crew-member-message');

  await page.locator('.thread').evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(jump(page)).toBeVisible();
  await pendingEdit(page)
    .getByRole('button', { name: 'Allow', exact: true })
    .dispatchEvent('click');
  await expect(bubble.getByRole('status')).toHaveText(`${name} has it`, { timeout: 30_000 });
  await expect(agentBlock(page, name)).toContainText('Message from the user', { timeout: 30_000 });
  expect(await page.locator('.thread').evaluate((element) => element.scrollTop)).toBeLessThan(40);
  expect(await gap(page)).toBeGreaterThan(80);
  await expect(jump(page)).toBeVisible();
  await expect(mine(page, 'Also log the date you parse.')).toHaveCount(1);
  await shots(page, 'crew-member-delivered');
});

test('a message the Builder never read says so and does not look delivered', async ({ page }) => {
  test.setTimeout(120_000);
  await waitingCrew(page);
  const name = await builderName(page);
  await messageBuilder(page, name, 'Skip the changelog.');
  const bubble = steered(page, 'Skip the changelog.');
  await expect(bubble.getByRole('status')).toHaveText(`${name} reads this at its next step`);

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(bubble.getByRole('status')).toHaveText(`${name} finished before reading this`, {
    timeout: 30_000,
  });
  await expect(bubble).toHaveClass(/\bmiss\b/);
  await expect(bubble).toHaveAttribute('data-steer', 'missed');
  await shots(page, 'crew-missed');
  await page.reload();
  await expect(steered(page, 'Skip the changelog.').getByRole('status')).toHaveText(
    `${name} finished before reading this`,
  );
});

test('a message sent now in a turn with one agent shows in the thread, then once as the next message', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await composer(page).fill('Keep going until I stop you #slowbuild');
  await composer(page).press('Enter');
  await expect(page.locator('.thread .ai-head').last().locator('.mood')).toHaveText('working');
  await holdSendNow(page);

  await composer(page).fill('Stop and summarise');
  await composer(page).press('ControlOrMeta+Enter');
  const bubble = steered(page, 'Stop and summarise');
  await expect(bubble).toBeVisible({ timeout: HELD_MS - 500 });
  await expect(bubble.getByRole('status')).toHaveText(/ reads this at its next step$/);
  await expect(bubble).toBeInViewport();
  await expect(composer(page)).toBeFocused();
  await shots(page, 'solo-send-now');

  await expect(page.locator('section[data-turn]')).toHaveCount(2, { timeout: 30_000 });
  await expect(steered(page, 'Stop and summarise')).toHaveCount(0);
  await expect(mine(page, 'Stop and summarise')).toHaveCount(1);
});
