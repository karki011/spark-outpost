import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import { seedTerminal } from './terminal-seed.ts';

const SHOTS = process.env.PALETTE_SHOTS ?? '';
const THEMES = { dark: 'graphite', light: 'apricot' } as const;

const palette = (page: Page) => page.getByRole('dialog', { name: 'Sessions' });
const field = (page: Page) => palette(page).getByRole('combobox', { name: 'Find a session' });
const rows = (page: Page) => palette(page).getByRole('option');
const titles = (page: Page) => palette(page).locator('.sp-title');
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });

async function seedSessions() {
  const ids = await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 6,
    },
    { title: 'Review the importer', minutesAgo: 5 },
    { title: 'Port the parser', minutesAgo: 4 },
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 3 },
    { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 2 },
    { title: 'Sketch the pricing page', message: 'Use the zebra palette.', minutesAgo: 1 },
    { title: 'Old launch notes', archived: true, minutesAgo: 90 },
  ]);
  await seedTerminal(ids[1]!, { state: 'waiting_for_permission', provider: 'codex' });
  await seedTerminal(ids[2]!, {
    state: 'working',
    cwd: '/Users/ada/code/parser',
    turn: {
      status: 'running',
      model: 'claude-sonnet-4-5',
      costUsd: 0.0832,
      steps: [{ name: 'Read' }, { name: 'Task', agentId: 'agent-1' }, { name: 'Bash', open: true }],
    },
  });
  return ids;
}

async function useTheme(page: Page, theme: string) {
  await page.addInitScript((theme) => localStorage.setItem('spark-outpost.theme', theme), theme);
}

async function snap(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `palette-${name}.png`) });
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

for (const [mode, theme] of Object.entries(THEMES)) {
  test(`the shortcut opens the palette with sessions that need you first, and typing filters it (${mode})`, async ({
    page,
  }) => {
    await seedSessions();
    await useTheme(page, theme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openChats(page);
    await page.getByRole('button', { name: 'New chat' }).first().focus();
    await page.keyboard.press('ControlOrMeta+Shift+K');

    await expect(field(page)).toBeFocused();
    await expect(titles(page)).toHaveText([
      'Review the importer',
      'Deploy the site',
      'Fix billing totals',
      'Port the parser',
      'Sketch the pricing page',
      'Tidy the README',
    ]);
    await expect(palette(page).getByRole('group')).toHaveCount(3);
    await expect(palette(page).getByRole('group', { name: 'Needs you' })).toBeVisible();
    const terminal = rows(page).filter({ hasText: 'Port the parser' });
    await expect(terminal).toContainText('parser · Claude · Terminal');
    await expect(terminal.locator('.sp-state')).toHaveText('Running');
    await expect(terminal.locator('.sp-line')).toHaveText(
      'Running a command · 3 steps · 1 sub-agent · ~$0.08',
    );
    const asking = rows(page).filter({ hasText: 'Review the importer' });
    await expect(asking).toContainText('Codex · Terminal');
    await expect(asking.locator('.sp-state')).toHaveText('Waiting for permission');
    await expect(rows(page).filter({ hasText: 'Deploy the site' }).locator('.sp-line')).toHaveText(
      'Fake provider wants to run pnpm deploy',
    );
    await expect(field(page)).toHaveAttribute(
      'aria-activedescendant',
      (await rows(page).first().getAttribute('id'))!,
    );
    await snap(page, `open-${mode}`);

    await field(page).fill('terminal');
    await expect(titles(page)).toHaveText(['Review the importer', 'Port the parser']);
    await snap(page, `filtered-${mode}`);
    await field(page).fill('zebra');
    await expect(titles(page)).toHaveText(['Sketch the pricing page']);
    await field(page).fill('launch');
    await expect(titles(page)).toHaveText(['Old launch notes']);
    await expect(rows(page).first().locator('.sp-state')).toHaveText('Archived');
    await field(page).fill('nothing matches this');
    await expect(palette(page)).toContainText('No sessions match.');
  });
}

test('arrow keys and Enter open a session, and Esc returns focus to where it was', async ({
  page,
}) => {
  await seedSessions();
  await page.setViewportSize({ width: 1280, height: 800 });
  await openChats(page);
  const search = page.getByRole('searchbox', { name: 'Search chats' });
  await page.keyboard.press('ControlOrMeta+K');
  await expect(search).toBeFocused();
  await expect(palette(page)).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(palette(page).getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows(page).last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await expect(search).toBeFocused();

  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await field(page).fill('tidy');
  await expect(titles(page)).toHaveText(['Tidy the README']);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Chats' }).locator('[aria-current="page"]'),
  ).toContainText('Tidy the README');
  await expect(message(page)).toBeFocused();

  await page.keyboard.press('ControlOrMeta+Shift+K');
  await rows(page).filter({ hasText: 'Fix billing totals' }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Chats' }).locator('[aria-current="page"]'),
  ).toContainText('Fix billing totals');
  await expect(message(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await field(page).fill('billing');
  await expect(titles(page)).toHaveText(['Fix billing totals']);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(message(page)).toBeFocused();

  await page.keyboard.press('ControlOrMeta+Shift+K');
  await field(page).fill('parser');
  await expect(titles(page)).toHaveText(['Port the parser']);
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Terminal session' }).getByRole('textbox', {
      name: 'Terminal input',
    }),
  ).toBeFocused();

  const menu = page.getByRole('button', { name: 'Terminal actions' });
  await menu.focus();
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(field(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

for (const [mode, theme] of Object.entries(THEMES)) {
  test(`the palette is a full-width sheet at phone width (${mode})`, async ({ page }) => {
    await seedSessions();
    await useTheme(page, theme);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+Shift+K');
    await expect(field(page)).toBeFocused();
    await expect
      .poll(async () => {
        const box = (await palette(page).boundingBox())!;
        return [box.x, box.y, box.width, box.height].map(Math.round);
      })
      .toEqual([0, 0, 390, 780]);
    await expect(titles(page)).toHaveCount(6);
    const overflow = await palette(page).evaluate((panel) => panel.scrollWidth > panel.clientWidth);
    expect(overflow).toBe(false);
    await expect(rows(page).filter({ hasText: 'Port the parser' }).locator('.sp-line')).toHaveText(
      /^Running\sa\scommand\s· 3\ssteps/,
    );
    await snap(page, `phone-${mode}`);
    await palette(page).getByRole('button', { name: 'Close' }).click();
    await expect(palette(page)).toHaveCount(0);
  });
}
