import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { useSystemTheme } from './docs-seed.ts';
import { openChats } from './navigation.ts';
import {
  COLUMN,
  PROMPTS,
  SHOTS,
  ask,
  columnEdges,
  composerGap,
  header,
  longChat,
  outline,
  pageScroll,
  preview,
  rail,
  shoot,
  ticks,
  turns,
  widenSecondReply,
  workPanel,
} from './chat-rail-kit.ts';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.describe('plain chats', () => {
  test.beforeEach(async ({ page }) => {
    await resetTestDatabase({ onboarded: true, catalog: true });
    await useSystemTheme(page);
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('the tick rail jumps to a message, follows the turn in view and works from the keyboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await longChat(page);
    await widenSecondReply(page);
    await expect(ticks(page)).toHaveCount(4);
    await expect(ticks(page).nth(0)).toHaveAccessibleName(/^Fix the date divider #plan/);
    await expect(ticks(page).nth(2)).toHaveAccessibleName(/, Error$/);
    await expect(ticks(page).nth(2)).toHaveAttribute('data-tone', 'error');
    await expect(ticks(page).nth(3)).toHaveAccessibleName(/…/);
    await expect(rail(page)).toBeVisible();
    await expect(rail(page)).not.toContainText('On this chat');
    await shoot(page, 'long-2000');

    const strip = (await outline(page).boundingBox())!;
    const beside = (await page.locator('.col').boundingBox())!;
    const scroller = (await page.locator('.thread').boundingBox())!;
    expect(strip.x).toBeGreaterThan(scroller.x);
    expect(strip.x - scroller.x).toBeLessThanOrEqual(24);
    expect(strip.x + strip.width).toBeLessThanOrEqual(beside.x - 12);
    expect(Math.abs(strip.y + strip.height / 2 - (scroller.y + scroller.height / 2))).toBeLessThan(
      8,
    );

    await ticks(page).nth(1).click();
    await expect(ticks(page).nth(1)).toHaveAttribute('aria-current', 'location');
    await expect(ticks(page).nth(1)).toHaveAttribute('data-reach', '0');
    await expect(ticks(page).nth(0)).toHaveAttribute('data-reach', '1');
    await expect(ticks(page).nth(3)).toHaveAttribute('data-reach', '2');
    await expect(turns(page).nth(1)).toBeFocused();
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
    expect(await composerGap(page)).toBeLessThanOrEqual(24);
    await expect(header(page)).toBeInViewport({ ratio: 1 });
    await shoot(page, 'outline-2000');

    const table = (await page.locator('.col .md-table').boundingBox())!;
    const longCode = (await page.locator('.col .md-code').first().boundingBox())!;
    const shortCode = (await page.locator('.col .md-code').nth(1).boundingBox())!;
    const column = (await page.locator('.col').boundingBox())!;
    const railBox = (await rail(page).boundingBox())!;
    expect(Math.abs(column.width - COLUMN)).toBeLessThan(1);
    for (const block of [table, longCode, shortCode]) {
      expect(Math.abs(block.x - column.x)).toBeLessThan(2);
      expect(Math.abs(block.x + block.width - column.x - column.width)).toBeLessThan(2);
      expect(block.x + block.width).toBeLessThan(railBox.x);
    }
    const composer = (await page.locator('.composer').boundingBox())!;
    expect(Math.abs(composer.width - column.width)).toBeLessThan(2);
    const prose = (await page.locator('.col .msg.ai .md > p').first().boundingBox())!;
    expect(Math.abs(prose.x - column.x)).toBeLessThan(2);
    expect(Math.abs(prose.x + prose.width - column.x - column.width)).toBeLessThan(2);
    expect(await pageScroll(page)).toBe(0);

    await ticks(page).nth(1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(ticks(page).nth(2)).toBeFocused();
    await expect(preview(page)).toContainText('Now break it #fail');
    await expect(preview(page)).toContainText('Error');
    await page.keyboard.press('End');
    await expect(ticks(page).nth(3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(ticks(page).nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(ticks(page).nth(3)).toHaveAttribute('aria-current', 'location');
    await expect(turns(page).nth(3)).toBeFocused();
    await expect(preview(page)).toHaveCount(0);
    await expect.poll(() => composerGap(page)).toBeLessThanOrEqual(24);
    await expect(header(page)).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        page
          .locator('.thread')
          .evaluate((thread) => thread.scrollHeight - thread.scrollTop - thread.clientHeight),
      )
      .toBeLessThan(1);

    await page.locator('.thread').evaluate((thread) => thread.scrollTo({ top: 0 }));
    await expect(ticks(page).nth(0)).toHaveAttribute('aria-current', 'location');

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .include('#chat-rail')
        .include('.oticks')
        .analyze();
      expect(scan.violations).toEqual([]);
    }
  });

  test('a tick previews its message and reply without moving the thread, with the work panel open too', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await longChat(page);
    await widenSecondReply(page);
    await expect(page.locator('.turn-meta')).toHaveCount(4);
    await animationsSettled(page);
    const thread = page.locator('.thread');
    const place = async () => ({
      column: await page.locator('.col').boundingBox(),
      top: await thread.evaluate((element) => element.scrollTop),
    });
    const before = await place();

    await ticks(page).nth(1).hover();
    await expect(preview(page)).toBeVisible();
    await expect(preview(page).locator('.oticks-ask')).toHaveText(
      'Compare the queue backends in a table',
    );
    await expect(preview(page).locator('.oticks-reply')).toContainText(
      'Here is the comparison you asked for',
    );
    await expect(ticks(page).nth(1)).toHaveAttribute('aria-describedby', /.+/);
    expect(await place()).toEqual(before);
    await shoot(page, 'tick-preview-2000');

    await ticks(page).nth(0).hover();
    await expect(preview(page)).toContainText('Fix the date divider #plan');
    await preview(page).click();
    await expect(ticks(page).nth(0)).toHaveAttribute('aria-current', 'location');
    await expect(turns(page).nth(0)).toBeFocused();
    await expect(preview(page)).toHaveCount(0);

    await ticks(page).nth(2).hover();
    await expect(preview(page).locator('.oticks-mark.error')).toHaveText('Error');
    await page.mouse.move(900, 20);
    await expect(preview(page)).toHaveCount(0);

    await header(page).getByRole('button', { name: 'Show work panel' }).click();
    await expect(workPanel(page)).toBeVisible();
    await expect(workPanel(page)).not.toContainText('On this chat');
    for (const width of [2000, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(ticks(page)).toHaveCount(4);
      await expect(ticks(page).first()).toBeVisible();
      await expect
        .poll(async () => {
          const { column, composer } = await columnEdges(page);
          return Math.abs(composer.left - column.left) + Math.abs(composer.right - column.right);
        })
        .toBeLessThan(1);
      await animationsSettled(page);
      const column = (await page.locator('.col').boundingBox())!;
      const main = (await page.getByRole('main').boundingBox())!;
      const strip = (await outline(page).boundingBox())!;
      expect(column.x - main.x).toBeGreaterThanOrEqual(56);
      expect(main.x + main.width - (column.x + column.width)).toBeGreaterThanOrEqual(56);
      expect(strip.x).toBeGreaterThan(main.x);
      expect(strip.x + strip.width).toBeLessThanOrEqual(column.x - 12);
      expect(await pageScroll(page)).toBe(0);
    }

    await header(page).getByRole('button', { name: 'Hide work panel' }).click();
    await expect(workPanel(page)).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(ticks(page).first()).toBeVisible();
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(outline(page)).toBeHidden();

    await page.setViewportSize({ width: 390, height: 800 });
    await expect(turns(page)).toHaveCount(4);
    await expect(outline(page)).toBeHidden();
    const phoneColumn = (await page.locator('.col').boundingBox())!;
    expect(phoneColumn.x).toBeLessThanOrEqual(32);
    expect(await pageScroll(page)).toBe(0);
  });

  test('a message sent to a running turn gets its own tick that jumps to its bubble', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await longChat(page);
    await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const detail = (await response.json()) as ConversationDetail;
      const run = detail.runs.filter((candidate) => !candidate.parentRunId)[1]!;
      const steer = {
        id: '30000000-0000-4000-8000-000000000001',
        runId: run.id,
        body: 'Also keep the week view as it is',
        urgency: 'now',
        status: 'delivered',
        messageId: null,
        createdAt: run.createdAt,
        deliveredAt: run.createdAt,
      };
      await route.fulfill({ response, json: { ...detail, memberMessages: [steer] } });
    });
    await page.reload();
    const bubble = page.locator('.msg.me.steered');
    await expect(bubble).toContainText('Also keep the week view as it is');
    await expect(ticks(page)).toHaveCount(5);
    await expect(ticks(page).nth(2)).toHaveAccessibleName('Also keep the week view as it is');

    await page.setViewportSize({ width: 2000, height: 700 });
    await page.locator('.thread').evaluate((thread) => thread.scrollTo({ top: 0 }));
    await ticks(page).nth(2).click();
    await expect(ticks(page).nth(2)).toHaveAttribute('aria-current', 'location');
    await expect(turns(page).nth(1)).toBeFocused();
    await expect
      .poll(async () => {
        const [target, thread] = await Promise.all([
          bubble.boundingBox(),
          page.locator('.thread').boundingBox(),
        ]);
        const toEnd = await page
          .locator('.thread')
          .evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
        return Math.min(Math.abs(target!.y - thread!.y), toEnd);
      })
      .toBeLessThan(40);
  });

  test('a long chat keeps every tick in a strip that never outgrows the thread', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await longChat(page, PROMPTS.slice(0, 3));
    await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const detail = (await response.json()) as ConversationDetail;
      const run = detail.runs[0]!;
      const ask = detail.messages.find((message) => message.id === run.userMessageId)!;
      const extra = Array.from({ length: 300 }, (_, index) => ({
        run: { ...run, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` },
        ask: { ...ask, id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}` },
      }));
      await route.fulfill({
        response,
        json: {
          ...detail,
          runs: [
            ...extra.map((item) => ({ ...item.run, userMessageId: item.ask.id })),
            ...detail.runs,
          ],
          messages: [...extra.map((item) => item.ask), ...detail.messages],
        },
      });
    });
    await page.reload();
    await expect(ticks(page)).toHaveCount(303);
    const strip = (await outline(page).boundingBox())!;
    const thread = (await page.locator('.thread').boundingBox())!;
    expect(strip.height).toBeLessThanOrEqual(488);
    expect(strip.y).toBeGreaterThanOrEqual(thread.y);
    expect(strip.y + strip.height).toBeLessThanOrEqual(thread.y + thread.height);
    const heights = await ticks(page).evaluateAll((all) =>
      all.map((tick) => tick.getBoundingClientRect().height),
    );
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(4);

    await page.locator('.thread').evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(ticks(page).first()).toHaveAttribute('aria-current', 'location');
    await expect(ticks(page).first()).toBeInViewport();
    await page
      .locator('.thread')
      .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(outline(page).locator('[aria-current]')).toBeInViewport();
    await expect(ticks(page).first()).not.toBeInViewport();
  });
});

test.describe('touch screens', () => {
  test.use({ hasTouch: true });

  test('a tap on a tick shows its preview and a second tap jumps there', async ({ page }) => {
    test.setTimeout(90_000);
    await resetTestDatabase({ onboarded: true, catalog: true });
    await page.setViewportSize({ width: 1600, height: 800 });
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await ask(page, PROMPTS);
    await widenSecondReply(page);
    await expect(ticks(page)).toHaveCount(4);
    await page.locator('.thread').evaluate((thread) => thread.scrollTo({ top: 0 }));
    await expect(ticks(page).nth(0)).toHaveAttribute('aria-current', 'location');

    await ticks(page).nth(3).tap();
    await expect(preview(page)).toContainText('Summarise what changed');
    await expect(ticks(page).nth(0)).toHaveAttribute('aria-current', 'location');
    await ticks(page).nth(3).tap();
    await expect(ticks(page).nth(3)).toHaveAttribute('aria-current', 'location');
    await expect(preview(page)).toHaveCount(0);

    await ticks(page).nth(0).tap();
    await expect(preview(page)).toContainText('Fix the date divider');
    await preview(page).tap();
    await expect(ticks(page).nth(0)).toHaveAttribute('aria-current', 'location');
    await ticks(page).nth(1).tap();
    await expect(preview(page)).toBeVisible();
    await page.locator('.composer').tap();
    await expect(preview(page)).toHaveCount(0);
  });
});
