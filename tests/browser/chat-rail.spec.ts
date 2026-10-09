import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { CREW_REQUEST, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';
import {
  COLUMN,
  LONG_TASKS,
  NOTES,
  PROMPTS,
  SHOTS,
  WIDE,
  ask,
  columnEdges,
  header,
  longChat,
  outline,
  pageScroll,
  rail,
  shoot,
  turns,
  widenSecondReply,
  workPanel,
} from './chat-rail-kit.ts';

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

const RAIL_SHOTS = process.env.RAIL_SHOTS ?? '';

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
    expect(Math.abs(column.width - COLUMN)).toBeLessThan(1);
    expect(railBox.x).toBeGreaterThan(column.x + column.width + 16);
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(thread.x + thread.width);
    expect(thread.x + thread.width - (railBox.x + railBox.width)).toBeLessThanOrEqual(40);
    expect(railBox.width).toBeGreaterThanOrEqual(280);
    const leftGutter = column.x - thread.x;
    const rightGutter = railBox.x - 16 - (column.x + column.width);
    expect(Math.abs(leftGutter - rightGutter)).toBeLessThan(24);
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
        .toBeLessThan(1);
      await expect
        .poll(async () => Math.abs((await page.locator('.col').boundingBox())!.width - COLUMN))
        .toBeLessThan(1);
      const column = (await page.locator('.col').boundingBox())!;
      const railBox = (await rail(page).boundingBox())!;
      const thread = (await page.locator('.thread').boundingBox())!;
      expect(railBox.x).toBeGreaterThanOrEqual(column.x + column.width + 16);
      expect(railBox.x + railBox.width).toBeLessThanOrEqual(thread.x + thread.width);
      expect(thread.x + thread.width - (railBox.x + railBox.width)).toBeLessThanOrEqual(40);
      expect(railBox.width).toBeGreaterThanOrEqual(216);
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
    const columnOff = async () =>
      Math.abs((await page.locator('.col').boundingBox())!.width - COLUMN);
    await expect.poll(columnOff).toBeLessThan(1);

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(rail(page)).toBeVisible();
    await expect.poll(columnOff).toBeLessThan(1);
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

  test('replies, the bubble and the composer share one centred column at every width', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await longChat(page);
    await widenSecondReply(page);
    const sharesEdges = async () => {
      const edges = await columnEdges(page);
      const { column } = edges;
      expect(Math.abs(edges.bubbleRight - column.right)).toBeLessThan(1);
      for (const part of [edges.prose, edges.head, edges.foot, edges.table, edges.composer]) {
        expect(Math.abs(part.left - column.left)).toBeLessThan(1);
        expect(Math.abs(part.right - column.right)).toBeLessThan(1);
      }
      expect(await pageScroll(page)).toBe(0);
      return edges;
    };

    for (const width of [1920, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(rail(page)).toBeVisible();
      const { column, thread } = await sharesEdges();
      expect(Math.abs(column.right - column.left - COLUMN)).toBeLessThan(1);
      const railBox = (await rail(page).boundingBox())!;
      const stripLeft = thread.right - railBox.width - 32;
      expect(Math.abs(column.left - thread.left - (stripLeft - column.right))).toBeLessThan(2);
    }

    await page.setViewportSize({ width: 1920, height: 900 });
    await rail(page).getByRole('button', { name: 'Hide context rail' }).click();
    await expect(rail(page)).toHaveCount(0);
    for (const width of [1920, 1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const { column, thread } = await sharesEdges();
      expect(Math.abs(column.left + column.right - thread.left - thread.right)).toBeLessThan(2);
      expect(column.right - column.left).toBeLessThanOrEqual(COLUMN + 1);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await header(page).getByRole('button', { name: 'Show work panel' }).click();
    await expect(workPanel(page)).toBeVisible();
    await expect
      .poll(async () => {
        const [thread, panel] = await Promise.all([
          page.locator('.thread').boundingBox(),
          workPanel(page).boundingBox(),
        ]);
        return thread!.x + thread!.width - panel!.x;
      })
      .toBeLessThanOrEqual(1);
    await sharesEdges();
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

  test('Agent TV docks in the rail while a turn runs, opens the full TV and leaves the crew listed when it ends', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await resetCrew();
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
    repo = crewRepo();
    await page.setViewportSize(WIDE);
    await crewChat(page, repo, 'Full auto');
    await send(page, `${CREW_REQUEST} #build #crew`);

    const dock = rail(page).locator('.crail-tv');
    await expect(dock).toBeVisible({ timeout: 30_000 });
    await expect(dock.locator('.tv-n').first()).toBeVisible();
    const stage = (await dock.locator('.crail-tv-stage').boundingBox())!;
    const dockRail = (await rail(page).boundingBox())!;
    expect(stage.width).toBeGreaterThanOrEqual(280);
    expect(stage.width).toBeLessThanOrEqual(dockRail.width);
    expect(stage.height).toBeGreaterThanOrEqual(175);
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
    const crew = rail(page).getByRole('region', { name: 'Crew' });
    const members = crew.getByRole('list', { name: 'Crew members' }).getByRole('listitem');
    await expect(crew.getByRole('heading')).toHaveText('Crew · 3 agents');
    await expect(members).toHaveCount(3);
    await expect(members.nth(0)).toContainText('JevDoneDispatcher');
    await expect(members.nth(1)).toContainText('BoltDoneBuilder · Opus 5.5');
    await expect(members.nth(2)).toContainText(/Hawk(Done|Failed)Critic/);
    expect(
      await crew.evaluate(
        (section) =>
          section.getAnimations({ subtree: true }).filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return animation.playState === 'running' && timing?.iterations === Infinity;
          }).length,
      ),
    ).toBe(0);
    const fits = await members.evaluateAll((rows) =>
      rows.every((row) => row.scrollWidth <= row.clientWidth),
    );
    expect(fits).toBe(true);
    await shoot(page, 'crew-done-2000');
    if (RAIL_SHOTS) await page.screenshot({ path: `${RAIL_SHOTS}/rail-finished-crew-light.png` });
    await crew.getByRole('button', { name: 'Open Agent TV' }).click();
    await expect(tv).toBeVisible();
    await tv.getByRole('button', { name: 'Close Agent TV' }).click();
    await page.reload();
    await expect(members).toHaveCount(3);
    await expect(members.nth(1)).toContainText('BoltDoneBuilder');
    await expect(members.nth(2)).toContainText('Critic');

    await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const detail = (await response.json()) as ConversationDetail;
      const members = Object.values(detail.orchestrations ?? {}).flatMap((entry) => entry.crew);
      const notes = members.map((member, index) => ({
        ...detail.messages[0]!,
        id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        role: 'assistant' as const,
        runId: member.runId,
        content: NOTES,
      }));
      const kept = detail.messages.filter(
        (message) => !members.some((member) => member.runId === message.runId),
      );
      await route.fulfill({ response, json: { ...detail, messages: [...kept, ...notes] } });
    });
    await page.reload();
    const notes = page
      .locator('.agent-block .md')
      .filter({ hasText: 'Still mapping the wiring' })
      .first()
      .locator('> p');
    await expect(notes).toHaveCount(9);
    const gaps = await notes.evaluateAll((all) =>
      all.slice(1).map((note, index) => {
        const above = all[index]!.getBoundingClientRect();
        return Math.round((note.getBoundingClientRect().top - above.bottom) * 100) / 100;
      }),
    );
    expect(new Set(gaps)).toEqual(new Set([8.25]));
    expect(await notes.first().evaluate((note) => getComputedStyle(note).lineHeight)).toBe('24px');
    await shoot(page, 'crew-notes-2000');
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
    await crewChat(page, repo, 'Ask before edits');
    await send(page, 'Fix the divider #build');
    await expect(page.getByRole('group', { name: /Change a file\?/ })).toBeVisible({
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
    await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const detail = (await response.json()) as ConversationDetail;
      const tasks = detail.tasks.map((task) => ({
        ...task,
        items: Array.from({ length: 12 }, (_, index) => ({
          ...task.items[index % task.items.length]!,
          id: `long-${index}`,
          label: LONG_TASKS[index % LONG_TASKS.length]!,
        })),
      }));
      await route.fulfill({ response, json: { ...detail, tasks } });
    });
    for (const [width, height] of [
      [1440, 900],
      [1440, 520],
      [2000, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.reload();
      await expect(rows).toHaveCount(12);
      const boxes = await rows.evaluateAll((all) =>
        all.map((row) => {
          const box = row.getBoundingClientRect();
          const label = row.querySelector('.crail-task-label')!.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, labelBottom: label.bottom };
        }),
      );
      for (const [index, box] of boxes.entries()) {
        expect(box.labelBottom).toBeLessThanOrEqual(box.bottom);
        if (index > 0) expect(box.top).toBeGreaterThanOrEqual(boxes[index - 1]!.bottom);
      }
    }
    await shoot(page, 'tasks-list-2000');
    const axe = await new AxeBuilder({ page }).include('.crail-tasks').analyze();
    expect(axe.violations).toEqual([]);
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
    const card = (await page.locator('.prc').boundingBox())!;
    const composer = (await page.locator('.composer').boundingBox())!;
    expect(card.y + card.height).toBeLessThanOrEqual(composer.y);
    const item = (await page.locator('.prc-item').boundingBox())!;
    const context = (await page.locator('.ctxbar').boundingBox())!;
    expect(Math.abs(item.width - context.width)).toBeLessThan(2);
    await shoot(page, 'pr-2000');
  });
});
