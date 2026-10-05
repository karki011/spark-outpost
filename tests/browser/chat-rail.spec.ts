import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { CREW_REQUEST, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';

const SHOTS = process.env.CHAT_WIDE_SHOTS ?? 'test-results/chat-rail';
const WIDE = { width: 2000, height: 1100 };
const PROMPTS = [
  'Fix the date divider #plan',
  'Compare the queue backends in a table',
  'Now break it #fail',
  'Summarise what changed across the calendar module and every component that reads dates',
];
const LONG_LINE =
  "  if (flags.forceRedis || metrics.requestsPerSecond > config.redisThreshold) return createRedisStreamsBackend(config.redis, { consumerGroup: 'spark-workers', blockMs: 250 });";
const WIDE_REPLY = [
  'Here is the comparison you asked for, with the options side by side.',
  '| Option | Throughput (req/s) | p50 latency | p99 latency | Memory | Notes on operating it in production over a long period |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Postgres advisory locks | 12,400 | 3.1 ms | 22 ms | 180 MB | Simple, no new moving parts, contention shows up as lock waits you can already observe |',
  '| Redis streams | 48,900 | 0.9 ms | 9 ms | 420 MB | Fast, but one more service to run, back up and monitor |',
  '',
  'And the function that picks between them:',
  '```ts',
  'export async function chooseQueueBackend(config: QueueConfig, metrics: MetricsSnapshot): Promise<QueueBackend> {',
  LONG_LINE,
  '  return createPostgresBackend(config.database);',
  '}',
  '```',
  'A short one stays narrow:',
  '```sh',
  'pnpm test',
  '```',
  'Prose keeps its measure while the table and the long code line use the room.',
].join('\n');

const rail = (page: Page) => page.getByRole('region', { name: 'Chat context' });
const outline = (page: Page) => page.getByRole('navigation', { name: 'On this chat' });
const turns = (page: Page) => page.locator('.thread section[aria-label="Turn"]');
const workPanel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const header = (page: Page) => page.getByRole('main').locator('.head');

async function ask(page: Page, prompts: readonly string[]) {
  const input = page.getByRole('textbox', { name: 'Message' });
  for (const [index, text] of prompts.entries()) {
    await input.fill(text);
    await input.press('Enter');
    await expect(turns(page)).toHaveCount(index + 1);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  }
}

async function longChat(page: Page, prompts: readonly string[] = PROMPTS) {
  await page.setViewportSize(WIDE);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await ask(page, prompts);
}

async function widenSecondReply(page: Page) {
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const second = detail.messages.filter((message) => message.role === 'assistant')[1];
    const messages = detail.messages.map((message) =>
      message.id === second?.id ? { ...message, content: WIDE_REPLY } : message,
    );
    await route.fulfill({ response, json: { ...detail, messages } });
  });
  await page.reload();
  await expect(page.locator('.md table')).toBeVisible();
}

async function shoot(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/chat-wide-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function pageScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function setWideWindows(page: Page, choice: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const group = page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('radiogroup', { name: 'On wide windows' });
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await group.getByRole('radio', { name: choice }).click();
  await saved;
  await expect(group.getByRole('radio', { name: choice })).toBeChecked();
  await page.keyboard.press('Escape');
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.describe('plain chats', () => {
  test.beforeEach(async ({ page }) => {
    await resetTestDatabase({ onboarded: true, catalog: true });
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('the rail shows beside a wide chat, never squeezes the column and hides when narrow', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(WIDE);
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await expect(rail(page)).toHaveCount(0);
    await shoot(page, 'empty-2000');
    await ask(page, PROMPTS.slice(0, 1));

    await expect(rail(page)).toBeVisible();
    await expect(workPanel(page)).toBeHidden();
    const rows = rail(page).getByRole('list', { name: 'This chat' });
    await expect(rows.getByRole('button', { name: 'Not linked. Choose project' })).toBeVisible();
    await expect(rows).toContainText('Opus 5.5');
    await expect(rows).toContainText('tokens');
    await expect(outline(page)).toHaveCount(0);
    await shoot(page, 'short-2000');

    const column = (await page.locator('.col').boundingBox())!;
    const railBox = (await rail(page).boundingBox())!;
    const thread = (await page.locator('.thread').boundingBox())!;
    expect(column.width).toBeGreaterThan(860);
    expect(railBox.x).toBeGreaterThan(column.x + column.width + 16);
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(thread.x + thread.width);
    expect(await pageScroll(page)).toBe(0);

    await rows.getByRole('button', { name: 'Not linked. Choose project' }).click();
    await expect(page.getByRole('dialog', { name: 'Project folders' })).toBeVisible();
    await page.keyboard.press('Escape');

    await rows.getByRole('button', { name: /tokens/ }).click();
    await expect(workPanel(page).getByRole('tab', { name: 'Cost' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(rail(page)).toHaveCount(0);
    await header(page).getByRole('button', { name: 'Hide work panel' }).click();
    await expect(rail(page)).toBeVisible();

    for (const width of [1280, 700]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(rail(page)).toHaveCount(0);
      expect(await pageScroll(page)).toBe(0);
    }
    await page.setViewportSize(WIDE);
    await expect(rail(page)).toBeVisible();
  });

  test('the rail shows at laptop widths whenever the work panel is closed, and hides when it opens or the window is small', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await longChat(page, PROMPTS.slice(0, 1));
    const showPanel = header(page).getByRole('button', { name: 'Show work panel' });
    const hidePanel = header(page).getByRole('button', { name: 'Hide work panel' });

    for (const width of [1728, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(rail(page)).toBeVisible();
      await expect
        .poll(async () => {
          const [column, composer] = await Promise.all([
            page.locator('.col').boundingBox(),
            page.locator('.composer').boundingBox(),
          ]);
          return Math.abs(column!.x - composer!.x) + Math.abs(column!.width - composer!.width);
        })
        .toBeLessThan(34);
      await expect
        .poll(async () => (await page.locator('.col').boundingBox())!.width)
        .toBeGreaterThanOrEqual(700);
      const column = (await page.locator('.col').boundingBox())!;
      const railBox = (await rail(page).boundingBox())!;
      const thread = (await page.locator('.thread').boundingBox())!;
      expect(column.width).toBeGreaterThanOrEqual(700);
      expect(railBox.x).toBeGreaterThanOrEqual(column.x + column.width + 16);
      expect(railBox.x + railBox.width).toBeLessThanOrEqual(thread.x + thread.width);
      expect(await pageScroll(page)).toBe(0);
      await shoot(page, `laptop-${width}`);

      await showPanel.click();
      await expect(workPanel(page)).toBeVisible();
      await expect(rail(page)).toHaveCount(0);
      expect(await pageScroll(page)).toBe(0);
      await hidePanel.click();
      await expect(rail(page)).toBeVisible();
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(rail(page)).toHaveCount(0);
    await showPanel.click();
    await expect(workPanel(page)).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await hidePanel.click();
    await expect(workPanel(page)).toBeHidden();
    await expect(rail(page)).toHaveCount(0);
    const columnWidth = async () => (await page.locator('.col').boundingBox())!.width;
    await expect.poll(columnWidth).toBeGreaterThanOrEqual(700);

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(rail(page)).toBeVisible();
    await expect.poll(columnWidth).toBeGreaterThanOrEqual(700);
  });

  test('the outline jumps to a prompt, follows the section in view and works from the keyboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await longChat(page);
    await widenSecondReply(page);
    const links = outline(page).getByRole('link');
    await expect(links).toHaveCount(4);
    await expect(links.nth(0)).toHaveText('Fix the date divider #plan');
    await expect(links.nth(2).getByText('Error')).toBeAttached();
    await expect(links.nth(3)).toContainText('…');
    await shoot(page, 'long-2000');

    await links.nth(1).click();
    await expect(links.nth(1)).toHaveAttribute('aria-current', 'location');
    await expect
      .poll(async () => {
        const [section, thread] = await Promise.all([
          turns(page).nth(1).boundingBox(),
          page.locator('.thread').boundingBox(),
        ]);
        const toEnd = await page
          .locator('.thread')
          .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
        return Math.min(Math.abs(section!.y - thread!.y), toEnd);
      })
      .toBeLessThan(40);
    await shoot(page, 'outline-2000');

    const table = (await page.locator('.md-table').boundingBox())!;
    const longCode = (await page.locator('.md-code').first().boundingBox())!;
    const shortCode = (await page.locator('.md-code').nth(1).boundingBox())!;
    const column = (await page.locator('.col').boundingBox())!;
    const railBox = (await rail(page).boundingBox())!;
    expect(column.width).toBeGreaterThan(1000);
    for (const block of [table, longCode, shortCode]) {
      expect(Math.abs(block.x - column.x)).toBeLessThan(2);
      expect(Math.abs(block.width - column.width)).toBeLessThan(2);
      expect(block.x + block.width).toBeLessThan(railBox.x);
    }
    const composer = (await page.locator('.composer').boundingBox())!;
    expect(Math.abs(composer.width - column.width)).toBeLessThan(2);
    const prose = (await page.locator('.md p').first().boundingBox())!;
    expect(prose.width).toBeLessThanOrEqual(column.width);
    expect(await pageScroll(page)).toBe(0);

    await links.nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(links.nth(3)).toHaveAttribute('aria-current', 'location');
    await expect(turns(page).nth(3)).toBeFocused();

    await page.locator('.thread').evaluate((thread) => thread.scrollTo({ top: 0 }));
    await expect(links.nth(0)).toHaveAttribute('aria-current', 'location');

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('#chat-rail')
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('#chat-rail')
      .analyze();
    expect(dark.violations).toEqual([]);
  });

  test('the rail collapses to a small toggle and stays collapsed after a reload', async ({
    page,
  }) => {
    await longChat(page, PROMPTS.slice(0, 1));
    const wideColumn = (await page.locator('.col').boundingBox())!;
    await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
    await expect(rail(page)).toHaveCount(0);
    const show = page.getByRole('button', { name: 'Show context rail' });
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    expect((await page.locator('.col').boundingBox())!.width).toBe(wideColumn.width);
    await page.reload();
    await expect(show).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await show.click();
    await expect(rail(page)).toBeVisible();
  });

  test('On wide windows picks the rail, the work panel or an empty margin', async ({ page }) => {
    test.setTimeout(90_000);
    await longChat(page, PROMPTS.slice(0, 1));
    await expect(rail(page)).toBeVisible();

    await setWideWindows(page, 'Work panel');
    await expect(workPanel(page)).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    const setup = await (await page.request.get('/api/setup')).json();
    expect(setup.profile.wideWindow).toBe('panel');

    await header(page).getByRole('button', { name: 'Hide work panel' }).click();
    await expect(workPanel(page)).toBeHidden();
    await page.reload();
    await expect(turns(page)).toHaveCount(1);
    await expect(workPanel(page)).toBeHidden();
    await expect(rail(page)).toHaveCount(0);

    await setWideWindows(page, 'Empty margin');
    await expect(workPanel(page)).toBeHidden();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show context rail' })).toHaveCount(0);
    await shoot(page, 'empty-margin-2000');

    await setWideWindows(page, 'Context rail');
    await expect(rail(page)).toBeVisible();
  });
});

test.describe('working chats', () => {
  let repo: CrewRepo | null = null;

  test.afterEach(() => {
    repo?.remove();
    repo = null;
  });

  test('Agent TV docks in the rail while a turn runs, opens the full TV and leaves when it ends', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await resetCrew();
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
    repo = crewRepo();
    await page.setViewportSize(WIDE);
    await crewChat(page, repo, 'Full auto');
    await send(page, CREW_REQUEST);

    const dock = rail(page).locator('.crail-tv');
    await expect(dock).toBeVisible({ timeout: 30_000 });
    await expect(dock.locator('.tv-n').first()).toBeVisible();
    await expect(rail(page).getByRole('list', { name: 'This chat' })).toContainText(
      'Full auto → PR',
    );
    await expect(rail(page).getByRole('list', { name: 'This chat' })).toContainText('worktree');
    await shoot(page, 'crew-run-2000');

    const before = (await page.locator('.col').boundingBox())!;
    await dock.getByRole('button', { name: /^Open Agent TV/ }).click();
    const tv = page.getByRole('dialog', { name: 'Agent TV' });
    await expect(tv).toBeVisible();
    await tv.getByRole('button', { name: 'Close Agent TV' }).click();
    await expect(tv).toBeHidden();

    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, {
      timeout: 120_000,
    });
    await expect(dock).toHaveCount(0);
    const after = (await page.locator('.col').boundingBox())!;
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
    await shoot(page, 'crew-done-2000');
  });

  test('tasks read as a plain list: one row per step with its state, the current one marked, no filled rows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await resetCrew();
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
    repo = crewRepo();
    await page.setViewportSize({ width: 1440, height: 900 });
    const profile = await page.request.patch('/api/profile', {
      data: { autoContinueSeconds: null },
    });
    expect(profile.ok()).toBe(true);
    await crewChat(page, repo, 'Auto-edit');
    await send(page, 'Tell me anything about this repo #build #vague #questions #three');
    await expect(page.getByRole('group', { name: /Spark has a few questions/ })).toBeVisible({
      timeout: 30_000,
    });

    const tasks = rail(page).getByRole('region', { name: 'Tasks' });
    await expect(tasks.getByRole('button', { name: /^1 of 3 tasks done/ })).toHaveText('1 of 3');
    const steps = tasks.getByRole('list', { name: 'Task steps' });
    const rows = steps.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveText(/^Done: /);
    await expect(rows.first()).not.toHaveAttribute('aria-current');
    const current = steps.locator('li[aria-current="step"]');
    await expect(current.first()).toHaveText(/^(Waiting for you|In progress): /);
    await expect(steps.locator('li[data-state="waiting"]')).toContainText('Waiting for you');

    const layout = await steps.evaluate((list) =>
      [...list.querySelectorAll('li')].map((row) => {
        const box = row.getBoundingClientRect();
        const mark = row.querySelector('.crail-task-mark')!.getBoundingClientRect();
        const label = row.querySelector('.crail-task-label')!.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          mark: Math.round(mark.left - box.left),
          label: Math.round(label.left - box.left),
          fill: getComputedStyle(row).backgroundColor,
          weight: getComputedStyle(row).fontWeight,
          current: row.hasAttribute('aria-current'),
        };
      }),
    );
    expect(new Set(layout.map((row) => row.fill))).toEqual(new Set(['rgba(0, 0, 0, 0)']));
    expect(new Set(layout.map((row) => row.mark)).size).toBe(1);
    expect(new Set(layout.map((row) => row.label)).size).toBe(1);
    expect(layout[0]!.label).toBeGreaterThan(layout[0]!.mark);
    for (const [index, row] of layout.entries()) {
      expect(row.weight).toBe(row.current ? '500' : '400');
      if (index > 0) expect(row.top - layout[index - 1]!.bottom).toBe(2);
    }
    const axe = await new AxeBuilder({ page }).include('.crail-tasks').analyze();
    expect(axe.violations).toEqual([]);
    await shoot(page, 'tasks-list-1440');
  });

  test('a chat with a pull request shows its checks and links the PR', async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await seedPrFollowUp();
    await page.setViewportSize(WIDE);
    await openChats(page);
    await page
      .getByRole('navigation', { name: 'Chats' })
      .getByRole('button', { name: /Fix the cents/ })
      .first()
      .click();
    const rows = rail(page).getByRole('list', { name: 'This chat' });
    await expect(rows).toContainText('Checks failing');
    const link = rows.getByRole('link', { name: /^Pull request acme\/widgets#7, Open/ });
    await expect(link).toHaveAttribute('href', /acme\/widgets\/pull\/7$/);
    const card = (await page.locator('.prs-wrap').boundingBox())!;
    const railBox = (await rail(page).boundingBox())!;
    expect(railBox.y).toBeGreaterThan(card.y + card.height);
    await shoot(page, 'pr-2000');
  });
});
