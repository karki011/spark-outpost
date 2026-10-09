import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { LONG_TASKS, WIDE, rail } from './chat-rail-kit.ts';
import { CREW_REQUEST, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';
import { useSystemTheme } from './docs-seed.ts';

const REVIEW_SHOTS = process.env.REVIEW_SHOTS ?? '';
const TASK_ROWS = 8;
const MIN_LIST = 40;

let repo: CrewRepo | null = null;

test.afterEach(() => {
  repo?.remove();
  repo = null;
});

async function turnEnds(page: Page) {
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
    timeout: 120_000,
  });
}

async function manyTasks(page: Page) {
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const tasks = detail.tasks.map((task) => ({
      ...task,
      items: Array.from({ length: TASK_ROWS }, (_, index) => ({
        ...task.items[index % task.items.length]!,
        id: `long-${index}`,
        label: LONG_TASKS[index % LONG_TASKS.length]!,
      })),
    }));
    await route.fulfill({ response, json: { ...detail, tasks } });
  });
}

function hidden(list: Locator): Promise<number> {
  return list.evaluate((element) => element.scrollHeight - element.clientHeight);
}

function height(list: Locator): Promise<number> {
  return list.evaluate((element) => element.clientHeight);
}

test('the rail lists the crew Agent TV shows after a later question, and its lists scroll only when the thread runs out of room', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await resetCrew();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light' });
  repo = crewRepo();
  await page.setViewportSize(WIDE);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${CREW_REQUEST} #build #crew`);
  await expect(rail(page).locator('.crail-tv')).toBeVisible({ timeout: 30_000 });
  await turnEnds(page);

  const crew = rail(page).getByRole('region', { name: 'Crew' });
  const members = crew.getByRole('list', { name: 'Crew members' });
  const names = () =>
    members
      .locator('.crow .nm b')
      .evaluateAll((all) => all.map((name) => name.firstChild?.textContent));
  await expect(members.getByRole('listitem')).toHaveCount(3);
  const built = await names();
  expect(built).toEqual(['Jev', 'Bolt', 'Hawk']);

  await send(page, 'How does notes.txt read? #debug');
  const turns = page.locator('.thread section[aria-label="Turn"]');
  await expect(turns).toHaveCount(2);
  await turnEnds(page);
  await expect(turns.nth(1)).toContainText('Answered without changing files');
  await expect(members.getByRole('listitem')).toHaveCount(3);
  expect(await names()).toEqual(built);

  await crew.getByRole('button', { name: 'Open Agent TV' }).click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await expect(tv).toBeVisible();
  for (const name of built) await expect(tv.locator('.tv-n', { hasText: name! })).toHaveCount(1);
  await expect(tv.locator('.tv-n')).toHaveCount(built.length);
  await tv.getByRole('button', { name: 'Close Agent TV' }).click();

  await manyTasks(page);
  await page.reload();
  const steps = rail(page).getByRole('list', { name: 'Task steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(TASK_ROWS);
  await expect(members.getByRole('listitem')).toHaveCount(3);
  const room = await page.evaluate(() => {
    const thread = document.querySelector('.thread')!.getBoundingClientRect();
    const context = document.querySelector('.crail')!.getBoundingClientRect();
    return thread.bottom - context.bottom;
  });
  expect(room).toBeGreaterThan(0);
  expect(await hidden(steps)).toBe(0);
  expect(await hidden(members)).toBe(0);
  if (REVIEW_SHOTS) {
    mkdirSync(REVIEW_SHOTS, { recursive: true });
    await page.screenshot({ path: `${REVIEW_SHOTS}/rail-crew-after.png` });
  }

  await page.setViewportSize({ width: WIDE.width, height: 620 });
  await expect.poll(() => hidden(steps)).toBeGreaterThan(0);
  expect(await height(steps)).toBeGreaterThanOrEqual(MIN_LIST);
  expect(await height(members)).toBeGreaterThanOrEqual(MIN_LIST);
  const fits = await page.evaluate(() => {
    const thread = document.querySelector('.thread')!.getBoundingClientRect();
    const context = document.querySelector('.crail')!.getBoundingClientRect();
    return context.bottom <= thread.bottom;
  });
  expect(fits).toBe(true);
});
