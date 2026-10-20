import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';
import { chatRepo, type ChatRepo } from './project-chat-kit.ts';
import {
  DESKTOP,
  expectNoSidewaysScroll,
  openTouch,
  shot,
  smallTapTargets,
} from './responsive-kit.ts';

test.describe.configure({ timeout: 180_000 });
test.use({ trace: 'off' });

const HANDLE = 'feature-web-apps';
const WIDTHS = [320, 375, 430];
const THEMES = ['light', 'dark'] as const;

let repo: ChatRepo;

async function sql(text: string, values: unknown[]) {
  const db = openTestDb();
  try {
    await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function chatInOutpost(page: Page): Promise<void> {
  await editedChat(page, repo.root);
  const chats = (await (await page.request.get('/api/conversations')).json()) as { id: string }[];
  const chatId = chats[0]!.id;
  const created = await page.request.post('/api/outposts', {
    data: {
      id: randomUUID(),
      name: 'Web apps launch',
      members: [{ conversationId: chatId, handle: HANDLE }],
    },
  });
  expect(created.ok()).toBe(true);
  await sql(
    `INSERT INTO run_prompt_cache (run_id, first_key, first_write, last_key, last_context, last_at,
       model, ttl_seconds)
     SELECT id, 'a', 2000, 'b', 182000, now(), 'claude-opus-5-5', 3600
     FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
}

const bar = (page: Page) => page.locator('.ctxbar');
const detailsChip = (page: Page) => bar(page).getByRole('button', { name: 'Chat details' });
const details = (page: Page) => page.getByRole('group', { name: 'Chat details' });

function crowdedChips(page: Page, rows: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const shown = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        !element.closest('.mpop, [role="tooltip"], .sr-only')
      );
    };
    const problems: string[] = [];
    for (const row of document.querySelectorAll(selector)) {
      const chips = [...row.children].filter(shown);
      chips.forEach((chip, index) => {
        const box = chip.getBoundingClientRect();
        for (const inner of chip.querySelectorAll('*')) {
          if (!shown(inner)) continue;
          const part = inner.getBoundingClientRect();
          const outside =
            part.left < box.left - 0.5 ||
            part.right > box.right + 0.5 ||
            part.top < box.top - 0.5 ||
            part.bottom > box.bottom + 0.5;
          if (outside)
            problems.push(
              `${inner.getAttribute('class')} spills out of ${chip.getAttribute('class')}`,
            );
        }
        for (const other of chips.slice(index + 1)) {
          const next = other.getBoundingClientRect();
          const apart =
            next.left >= box.right - 0.5 ||
            next.right <= box.left + 0.5 ||
            next.top >= box.bottom - 0.5 ||
            next.bottom <= box.top + 0.5;
          if (!apart)
            problems.push(`${chip.getAttribute('class')} overlaps ${other.getAttribute('class')}`);
        }
        if (box.left < -0.5 || box.right > document.documentElement.clientWidth + 0.5) {
          problems.push(`${chip.getAttribute('class')} leaves the screen`);
        }
      });
    }
    return problems;
  }, rows);
}

function fitsComposer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const composer = document.querySelector('.composer')!.getBoundingClientRect();
    const wrap = document.querySelector('.ctxbar-wrap')!.getBoundingClientRect();
    return wrap.left >= composer.left - 0.5 && wrap.right <= composer.right + 0.5;
  });
}

test.beforeEach(async ({ page }) => {
  repo = chatRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await page.setViewportSize(DESKTOP);
  await chatInOutpost(page);
});

test.afterEach(() => repo.remove());

for (const width of WIDTHS) {
  test(`the context bar keeps its chips apart at ${width}px`, async ({ browser }) => {
    const page = await openTouch(browser, { width, height: 800 }, 'chats');
    const outpost = bar(page).locator('.ctx-outpost');
    await expect(outpost).toContainText(`@${HANDLE}`, { timeout: 20_000 });
    expect(await crowdedChips(page, '.ctx-row, .comp-bar')).toEqual([]);
    await expect(bar(page).locator('.ctx-place')).toBeVisible();
    await expect(bar(page).getByRole('button', { name: /^Spark autonomy/ })).toHaveCount(0);
    for (const hidden of ['.ctx-setup', '.ctx-repo', '.cache-timer']) {
      await expect(bar(page).locator(hidden)).toBeHidden();
    }
    expect(await fitsComposer(page)).toBe(true);
    expect(await smallTapTargets(page, '.ctx-details')).toEqual([]);
    await expectNoSidewaysScroll(page);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await shot(page, `context-bar-${theme}`);
    }

    await detailsChip(page).click();
    await expect(detailsChip(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(details(page).getByRole('button', { name: /^Agent setup/ })).toBeVisible();
    await expect(details(page).getByRole('button', { name: /^Project folders/ })).toBeVisible();
    await expect(details(page).locator('.cache-timer')).toHaveCount(0);
    expect(await crowdedChips(page, '.ctxbar, .ctx-row, .ctx-more, .comp-bar')).toEqual([]);
    await expectNoSidewaysScroll(page);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await shot(page, `context-bar-details-${theme}`);
    }

    await details(page)
      .getByRole('button', { name: /^Agent setup/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Agent setup' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Agent setup' })).toBeHidden();
    await details(page)
      .getByRole('button', { name: /^Project folders/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Project folders' })).toBeVisible();
    await page.close();
  });
}

test('a paired phone without the settings switch gets no agent setup in Details', async ({
  browser,
}) => {
  const page = await openTouch(browser, { width: 375, height: 800 }, 'chats', async (opened) => {
    await opened.route('**/api/remote/session', async (route) => {
      const response = await route.fetch();
      const session = (await response.json()) as RemoteSession;
      await route.fulfill({
        response,
        json: { ...session, remote: true, switches: { ...session.switches, settings: false } },
      });
    });
  });
  await expect(bar(page).locator('.ctx-outpost')).toBeVisible({ timeout: 20_000 });
  await detailsChip(page).click();
  await expect(details(page).getByRole('button', { name: /^Project folders/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Agent setup/ })).toHaveCount(0);
  await page.close();
});

test('the desktop context bar keeps its chips, with no autonomy or Details chip', async ({
  page,
}) => {
  await page.goto('/');
  await expect(bar(page).locator('.ctx-outpost')).toContainText(`@${HANDLE}`, {
    timeout: 20_000,
  });
  for (const chip of ['.ctx-repo', '.ctx-place', '.ctx-setup', '.cache-timer']) {
    await expect(bar(page).locator(chip)).toBeVisible();
  }
  await expect(detailsChip(page)).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: /^Spark autonomy/ })).toHaveCount(0);
  expect(await crowdedChips(page, '.ctxbar')).toEqual([]);
});
