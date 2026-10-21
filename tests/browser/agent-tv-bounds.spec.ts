import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';
import { resetWithAgents } from './project-chat-kit.ts';

const SHOTS = process.env.SPARK_REVIEW_SHOTS ?? '';

const WIDE = { width: 1680, height: 1000 };
const NARROW = { width: 1180, height: 820 };

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetWithAgents();
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tv-fresh')) return;
    sessionStorage.setItem('tv-fresh', '1');
    localStorage.removeItem('spark-outpost.agent-tv');
  });
});

const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });

async function wideSubagent(page: Page) {
  await withDesktopBrowser(page);
  await page.setViewportSize(WIDE);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Pull the settings spec #build #subagentswide');
  await input.press('Enter');
  await expect(page.locator('.msg.ai .mood').last()).toHaveText('waiting on 1 sub-agent', {
    timeout: 30_000,
  });
  await toggleHeaderPane(page, 'Browser');
  await expect(page.getByRole('region', { name: 'Browser' })).toBeVisible();
  await toggleHeaderPane(page, 'Agent TV');
  await expect(tvOf(page)).toBeVisible();
  await settled(page);
}

async function settled(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await expect.poll(() => tvOf(page).evaluate((element) => element.getAnimations().length)).toBe(0);
}

async function expectInsideChatColumn(page: Page) {
  const tv = (await tvOf(page).boundingBox())!;
  const chat = (await page.locator('main.main').boundingBox())!;
  const pane = (await page.locator('#work-panel .wp-in').boundingBox())!;
  const composer = (await page.locator('main.main .composer-wrap').boundingBox())!;
  expect(tv.x).toBeGreaterThanOrEqual(chat.x);
  expect(tv.x + tv.width).toBeLessThanOrEqual(Math.min(chat.x + chat.width, pane.x));
  expect(tv.y + tv.height).toBeLessThanOrEqual(composer.y);
  expect(tv.y).toBeGreaterThanOrEqual(chat.y);
}

async function expectCardFits(page: Page) {
  const card = tvOf(page).getByRole('list', { name: 'Sub-agents' }).getByRole('listitem');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Extract settings spec from design');
  const activity = card.locator('.ac-now');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('title', /^cd "\/Users\/someone\/Downloads/);
  expect((await card.innerText()).split('cd "/Users/someone').length - 1).toBe(1);
  const overflow = await tvOf(page).evaluate((element) =>
    [element, ...element.querySelectorAll('.ac-card, .tv-subagents')].filter(
      (node) => node.scrollWidth > node.clientWidth + 1,
    ),
  );
  expect(overflow).toHaveLength(0);
}

test('Agent TV stays inside the chat column beside the Browser pane, above the composer', async ({
  page,
}) => {
  await wideSubagent(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'agent-tv-bounds-wide.png') });
  await expectInsideChatColumn(page);
  await expectCardFits(page);

  const stage = (await tvOf(page).locator('.tv-stage').boundingBox())!;
  expect(stage.height).toBeLessThan(250);

  const docked = (await tvOf(page).boundingBox())!;
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(page.getByRole('region', { name: 'Browser' })).toBeHidden();
  await expect.poll(async () => (await tvOf(page).boundingBox())!.x).toBeGreaterThan(docked.x);
  await page.keyboard.press('ControlOrMeta+Shift+B');
  await expect(page.getByRole('region', { name: 'Browser' })).toBeVisible();
  await settled(page);
  await expectInsideChatColumn(page);

  await page.setViewportSize(NARROW);
  await settled(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'agent-tv-bounds-narrow.png') });
  await expectInsideChatColumn(page);
  await expectCardFits(page);

  await tvOf(page).getByRole('radio', { name: 'L', exact: true }).click();
  await settled(page);
  await expectInsideChatColumn(page);
  await expectCardFits(page);

  await page.setViewportSize(WIDE);
  await settled(page);
  await expectInsideChatColumn(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
});
