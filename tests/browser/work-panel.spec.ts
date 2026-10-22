import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { TaskDetail } from '../../packages/contracts/src/tasks.ts';
import {
  BUILD_REQUEST,
  chatRepo,
  type ChatRepo,
  keptResult,
  projectChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.FILES_SHOTS ?? '';
const RAIL_SHOTS = process.env.RAIL_SHOTS ?? '';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const skin of ['graphite', 'apricot']) {
    await page.evaluate((value) => (document.documentElement.dataset.skin = value), skin);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `files-${name}-${skin}.png`) });
  }
}

async function addEstimatedTurns(page: Page) {
  await page.route(/\/api\/tasks\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const task = (await response.json()) as TaskDetail;
    const reported = task.runs.map((run) => ({
      ...run,
      costUsd: 1200,
      costSource: 'reported' as const,
    }));
    const estimated = task.runs.map((run) => ({
      ...run,
      tokens: 5_499_000,
      costUsd: 34.56,
      costSource: 'estimated' as const,
    }));
    await route.fulfill({ response, json: { ...task, runs: [...reported, ...estimated] } });
  });
}

async function overlappingCells(page: Page): Promise<string[]> {
  return panel(page)
    .getByRole('list', { name: 'Cost by agent' })
    .evaluate((list) => {
      const overlaps: string[] = [];
      for (const row of list.querySelectorAll('li')) {
        const cells = [...row.children].map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const ink = range.getBoundingClientRect();
          const box = cell.getBoundingClientRect();
          return { name: cell.className, left: ink.left, right: Math.min(ink.right, box.right) };
        });
        const inked = cells.filter((cell) => cell.right > cell.left);
        for (const [index, cell] of inked.entries()) {
          const next = inked[index + 1];
          if (next && cell.right > next.left + 0.5) overlaps.push(`${cell.name} over ${next.name}`);
        }
        const rowBox = row.getBoundingClientRect();
        if (
          inked.some((cell) => cell.left < rowBox.left - 0.5 || cell.right > rowBox.right + 0.5)
        ) {
          overlaps.push('outside the row');
        }
      }
      return overlaps;
    });
}

async function panelWidth(page: Page): Promise<number> {
  return Math.round((await panel(page).boundingBox())?.width ?? 0);
}

test('the work panel is wider by default, resizes from its edge and remembers the width', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.todo-line')).toContainText('3 of 3 done', { timeout: 20_000 });
  await expect.poll(() => panelWidth(page)).toBe(432);

  const handle = page.getByRole('separator', { name: 'Resize work panel' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 97, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => panelWidth(page)).toBe(532);
  await expect(handle).toHaveAttribute('aria-valuenow', '532');

  await page.reload();
  await expect.poll(() => panelWidth(page)).toBe(532);

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => panelWidth(page)).toBe(516);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => panelWidth(page)).toBe(548);
  await page.keyboard.press('Home');
  await expect.poll(() => panelWidth(page)).toBe(340);
  await page.keyboard.press('End');
  await expect.poll(() => panelWidth(page)).toBe(640);
  await handle.dblclick();
  await expect.poll(() => panelWidth(page)).toBe(432);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(handle).toHaveCount(0);
});

test('the work panel slides open and closed without moving the thread', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1600, height: 420 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  const rail = page.getByRole('region', { name: 'Chat context' });
  await expect(rail.getByRole('region', { name: 'To-do' })).toContainText('3 of 3', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'To-do: 3 of 3 done' }).click();
  await page
    .getByRole('main')
    .locator('.head')
    .getByRole('button', { name: 'Show work panel' })
    .click();
  await expect.poll(() => panelWidth(page)).toBe(432);

  const thread = page.locator('.thread');
  const range = await thread.evaluate((element) => element.scrollHeight - element.clientHeight);
  expect(range).toBeGreaterThan(120);
  const middle = 24;
  await thread.evaluate((element, top) => (element.scrollTop = top), middle);
  const scrollTop = () => thread.evaluate((element) => element.scrollTop);
  const header = page.getByRole('main').locator('.head');
  const title = await header.locator('.chat-title').boundingBox();

  const aside = page.locator('#work-panel');
  const asideWidth = async () => Math.round((await aside.boundingBox())?.width ?? -1);
  await header.getByRole('button', { name: 'Hide work panel' }).click();
  await expect.poll(asideWidth).toBe(0);
  await expect(panel(page)).toBeHidden();
  expect(await scrollTop()).toBe(middle);
  expect(await header.locator('.chat-title').boundingBox()).toEqual(title);

  await header.getByRole('button', { name: 'Show work panel' }).click();
  await expect.poll(() => panelWidth(page)).toBe(432);
  expect(await scrollTop()).toBe(middle);
});

test.describe('a finished change', () => {
  let repo: ChatRepo;

  test.beforeEach(async ({ page }) => {
    await resetWithAgents();
    repo = chatRepo();
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test.afterEach(() => repo.remove());

  test('the kept record lists the changed files and Cost shows the agent', async ({ page }) => {
    test.setTimeout(90_000);
    await projectChat(page, repo, 'Full auto');
    await send(page, `${BUILD_REQUEST} #build`);
    await turnDone(page, 30_000);

    const kept = keptResult(page);
    await kept.getByRole('button', { name: 'Kept · 1 file' }).click();
    const files = kept.locator('.fchg');
    await expect(files).toContainText('1 file changed+1 −0');
    await files.getByRole('button', { name: 'Open the diff of notes.txt' }).click();
    const drawer = page.getByRole('dialog', { name: 'Changes · 1 file' });
    await expect(drawer.locator('.cm-content')).toContainText('step 1', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    const work = panel(page);
    await work.getByRole('tab', { name: 'Cost' }).click();
    const rows = work.getByRole('list', { name: 'Cost by agent' }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Claude');
    for (const row of await rows.all()) {
      const height = (await row.boundingBox())!.height;
      expect(height).toBeLessThan(40);
    }
    await shot(page, 'cost');

    await addEstimatedTurns(page);
    await page.reload();
    await work.getByRole('tab', { name: 'Cost' }).click();
    await expect(rows.nth(0).locator('.cost-usd')).toContainText('~$1234');
    await expect(rows.locator('.cost-note')).toHaveCount(0);
    await expect(rows.nth(0).locator('.cost-text')).toHaveAttribute('title', /^Includes estimated/);
    await expect(work.locator('.cost-total')).toContainText('includes estimates');
    const handle = page.getByRole('separator', { name: 'Resize work panel' });
    for (const key of ['End', 'Home']) {
      await handle.focus();
      await page.keyboard.press(key);
      await expect.poll(() => overlappingCells(page)).toEqual([]);
    }
    await expect.poll(() => panelWidth(page)).toBe(340);
    const rights = await rows.evaluateAll((all) =>
      all.map((row) => Math.round(row.querySelector('.cost-usd')!.getBoundingClientRect().right)),
    );
    expect(new Set(rights).size).toBe(1);
    if (RAIL_SHOTS) await work.screenshot({ path: path.join(RAIL_SHOTS, 'cost-by-agent-340.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    await expect.poll(() => overlappingCells(page)).toEqual([]);
    await page.setViewportSize({ width: 1400, height: 900 });

    await work.getByRole('button', { name: 'View in audit' }).click();
    await expect(page.getByRole('dialog', { name: /Audit/ })).toBeVisible();
  });
});
