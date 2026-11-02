import { expect, test, type Page } from '@playwright/test';
import {
  chatMenuButton,
  chatMenuDot,
  expectHeaderPane,
  headerPaneItem,
  openChatMenu,
  toggleHeaderPane,
} from './header-menu.ts';
import {
  BUILD_REQUEST,
  card,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
} from './project-chat-kit.ts';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('tv-fresh')) return;
    sessionStorage.setItem('tv-fresh', '1');
    localStorage.removeItem('spark-outpost.agent-tv');
  });
});

test.afterEach(() => repo.remove());

const tvOf = (page: Page) => page.getByRole('dialog', { name: 'Agent TV' });
const agent = (page: Page) => tvOf(page).locator('.tv-n[data-role="agent"]');
const details = (page: Page) => tvOf(page).getByRole('group', { name: / details$/ });
const turn = (page: Page) => page.locator('.msg.ai').last();
const savedTv = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('spark-outpost.agent-tv') ?? '{}') as unknown,
  );

async function scrollThread(page: Page, to: 'top' | 'bottom') {
  await page
    .locator('.thread')
    .evaluate((element, end) => (element.scrollTop = end === 'top' ? 0 : element.scrollHeight), to);
}

async function settled(page: Page) {
  await tvOf(page).evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
}

async function waitingAgent(page: Page) {
  await projectChat(page, repo, 'Ask before edits');
  await send(page, `${BUILD_REQUEST} #build`);
  const edit = card(page, /^Edit .+\?$/);
  await expect(edit).toBeVisible({ timeout: 30_000 });
  return edit;
}

async function tvWhileWaiting(page: Page) {
  const edit = await waitingAgent(page);
  await toggleHeaderPane(page, 'Agent TV');
  await expect(tvOf(page)).toBeVisible();
  await settled(page);
  return edit;
}

test('the chat menu says one agent is working and opens Agent TV', async ({ page }) => {
  test.setTimeout(60_000);
  await projectChat(page, repo, 'Auto-edit');
  await send(page, `${BUILD_REQUEST} #build #slowbuild`);
  await expect(chatMenuButton(page)).toHaveAccessibleName('Chat actions. 1 agent working.', {
    timeout: 30_000,
  });
  await expect(chatMenuDot(page)).toHaveClass(/live/);
  await openChatMenu(page);
  await expect(headerPaneItem(page, 'Agent TV')).toHaveAttribute('aria-checked', 'false');
  await expect(headerPaneItem(page, 'Agent TV')).toContainText('1 working');
  await headerPaneItem(page, 'Agent TV').click();
  await expect(tvOf(page)).toBeVisible();
  await expectHeaderPane(page, 'Agent TV', true);
  await expect(agent(page)).toHaveCount(1);
  await tvOf(page).getByRole('button', { name: 'Close Agent TV' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(chatMenuButton(page)).toHaveAccessibleName('Chat actions.', { timeout: 30_000 });
});

test('clicking the agent shows its status, Go to scrolls, and Esc steps back', async ({ page }) => {
  test.setTimeout(60_000);
  const edit = await tvWhileWaiting(page);
  const tv = tvOf(page);

  await agent(page).click();
  const bubble = details(page);
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Claude');
  await expect(agent(page)).toHaveAttribute('aria-expanded', 'true');
  const stage = (await tv.locator('.tv-stage').boundingBox())!;
  const shown = (await bubble.boundingBox())!;
  expect(shown.y).toBeGreaterThanOrEqual(stage.y);
  expect(shown.y + shown.height).toBeLessThanOrEqual(stage.y + stage.height);

  await scrollThread(page, 'top');
  await bubble.getByRole('button', { name: 'Go to' }).click();
  await expect(bubble).toBeHidden();
  await expect(turn(page)).toBeInViewport();

  await agent(page).click();
  await expect(bubble).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bubble).toBeHidden();
  await expect(tv).toBeVisible();

  const ask = tv.getByRole('button', { name: /change notes\.txt\?/i });
  await expect(ask).toBeVisible();
  const asked = (await ask.boundingBox())!;
  expect(asked.y).toBeGreaterThanOrEqual(stage.y);
  await scrollThread(page, 'top');
  await ask.click();
  await expect(edit).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(tv).toBeHidden();
  await expect(chatMenuButton(page)).toBeFocused();
});

test('keyboard: Enter opens the bubble and Enter again goes to the agent', async ({ page }) => {
  test.setTimeout(60_000);
  await tvWhileWaiting(page);
  await agent(page).focus();
  await page.keyboard.press('Enter');
  await expect(details(page)).toBeVisible();
  await scrollThread(page, 'top');
  await page.keyboard.press('Enter');
  await expect(turn(page)).toBeInViewport();
});

test('the header controls explain themselves on keyboard focus, and mute is remembered', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await tvWhileWaiting(page);
  const tv = tvOf(page);
  const tooltip = page.getByRole('tooltip');
  await tv.getByRole('button', { name: 'Watch mode' }).focus();
  await page.keyboard.press('Shift+Tab');
  const mute = tv.getByRole('button', { name: 'Mute speech bubbles' });
  await expect(mute).toBeFocused();
  await expect(tooltip).toHaveText('Mute speech bubbles');
  await expect(mute).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(tooltip).toHaveText('Show speech bubbles');
  expect(await savedTv(page)).toMatchObject({ muted: true });
  await page.keyboard.press('Shift+Tab');
  await expect(tooltip).toHaveText('Small / Medium / Large TV');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(tooltip).toHaveText('Watch mode');
  await page.keyboard.press('Tab');
  await expect(tv.getByRole('button', { name: 'Close Agent TV' })).toBeFocused();
  await expect(tooltip).toHaveText('Close Agent TV (Esc)');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});

test('with reduced motion the face holds still', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await tvWhileWaiting(page);
  await expect(tvOf(page)).toHaveClass(/\bstill\b/);
  const bob = await agent(page)
    .locator('.tv-b')
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(bob).toBe('none');
  await agent(page).click();
  await expect(details(page)).toBeVisible();
  const animations = await agent(page)
    .locator('.tv-sq')
    .evaluate((element) => element.getAnimations().length);
  expect(animations).toBe(0);
});

test('sizes and watch mode grow the stage, and the size is remembered', async ({ page }) => {
  test.setTimeout(60_000);
  await tvWhileWaiting(page);
  const tv = tvOf(page);
  const stageWidth = () =>
    tv.locator('.tv-stage').evaluate((element) => (element as HTMLElement).offsetWidth);
  expect(await stageWidth()).toBe(300);
  await tv.getByRole('radio', { name: 'L', exact: true }).click();
  await expect.poll(stageWidth).toBe(460);

  await tv.getByRole('button', { name: 'Watch mode' }).click();
  await expect(tv).toHaveClass(/\bwatch\b/);
  await expect.poll(stageWidth).toBeGreaterThan(900);
  await page.keyboard.press('Escape');
  await expect(tv).not.toHaveClass(/\bwatch\b/);
  await expect(tv).toBeVisible();
  await expect.poll(stageWidth).toBe(460);
  expect(await savedTv(page)).toMatchObject({ size: 'l' });
});

test('dragging moves the TV and the position survives a reload', async ({ page }) => {
  test.setTimeout(60_000);
  await tvWhileWaiting(page);
  const header = tvOf(page).locator('.tv-h');
  const start = (await header.boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x - 150, start.y - 150, { steps: 6 });
  await page.mouse.up();
  const moved = (await tvOf(page).boundingBox())!;
  const { position } = (await savedTv(page)) as { position: { x: number; y: number } };
  expect(Math.round(moved.x)).toBe(Math.round(position.x));

  await page.reload();
  await toggleHeaderPane(page, 'Agent TV');
  await settled(page);
  const again = (await tvOf(page).boundingBox())!;
  expect(Math.round(again.x)).toBe(Math.round(moved.x));
  expect(Math.round(again.y)).toBe(Math.round(moved.y));
});

test('Agent TV keeps following its chat while you look at another one', async ({ page }) => {
  test.setTimeout(90_000);
  const edit = await tvWhileWaiting(page);
  const tv = tvOf(page);
  await tv.getByRole('radio', { name: 'List' }).click();
  const row = tv.getByRole('list', { name: 'Running' }).getByRole('listitem');
  await expect(row).toHaveCount(1);

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    /^Ask anything/,
  );
  await expect(tv).toBeVisible();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /^Open .+ in the chat$/ }).click();
  await expect(edit).toBeVisible();
  await expect(tv).toBeVisible();
});
