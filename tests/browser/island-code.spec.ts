import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { crewRepo, pickPermission, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import {
  fakeHomeDesktop,
  fakeState,
  island,
  nowCard,
  openHome,
  openIsland,
} from './island-home-desktop.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_CODE_SHOTS ?? '';

let repo: CrewRepo;

test.beforeEach(async () => {
  repo = crewRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(SHOTS, `island-code-${name}.png`),
    clip: { x: 180, y: 0, width: 920, height: 460 },
  });
}

async function editsChat(page: Page, edits: number): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(repo.root)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(`Rewrite the live table #livediff ${edits} 5ms`);
  await input.press('Enter');
  await expect(page.locator('.md', { hasText: `livediff=done ${edits}` })).toBeVisible({
    timeout: 20_000,
  });
}

async function islandPage(page: Page, theme = 'graphite'): Promise<Page> {
  const next = await page.context().newPage();
  await fakeHomeDesktop(next, theme);
  await openIsland(next);
  await openHome(next);
  return next;
}

const log = (page: Page) => nowCard(page).getByRole('list', { name: 'Latest steps' });

test('an edit step shows its line counts and opens a diff peek with the keyboard', async ({
  page,
}) => {
  await editsChat(page, 8);
  const view = await islandPage(page);

  await expect(log(view).getByRole('listitem')).toHaveText([
    'Done: Edited · module2.ts +2 −0',
    'Done: Edited · growing.ts +100 −0',
    'Done: Edited · module3.ts +2 −0',
  ]);
  await expect(nowCard(view).locator('.isl-now-said')).toHaveText('Finished: livediff=done 8');
  await shot(view, 'rows');

  const row = log(view).getByRole('button', {
    name: 'Edited growing.ts, 100 added, 0 removed. Show the change',
  });
  await row.focus();
  await view.keyboard.press('Enter');
  const peek = nowCard(view).getByRole('group', { name: 'Change to growing.ts' });
  await expect(peek).toBeVisible();
  await expect(peek.getByRole('button', { name: 'Back to steps' })).toBeFocused();
  const diff = peek.getByRole('region', { name: 'Changes to growing.ts' });
  await expect(diff).toContainText("export const row0 = compute(0, 'row 0 written live');");
  await expect(diff.locator('.dv-row')).toHaveCount(80);
  await expect(diff).toContainText('20 more lines');
  await expect(peek).toContainText('src/live');
  await expect(nowCard(view).getByRole('list', { name: 'Latest steps' })).toHaveCount(0);
  const axe = await new AxeBuilder({ page: view }).include('.isl-now').analyze();
  expect(axe.violations).toEqual([]);
  await shot(view, 'peek');

  await view.keyboard.press('Tab');
  await expect(diff).toBeFocused();
  await view.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await expect(island(view).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toBeFocused();

  await row.click();
  await peek.getByRole('button', { name: 'Back to steps' }).click();
  await expect(row).toBeFocused();

  await row.click();
  await expect(peek.getByRole('button', { name: /editor/i })).toHaveCount(0);
  await peek.getByRole('button', { name: 'Open chat' }).click();
  const opened = await fakeState(view);
  expect(opened.openedChats).toHaveLength(1);
  expect(opened.openedTurns[0]).toMatch(/^[0-9a-f-]{36}$/);
});

const numbered = (change: (line: number) => string | null) =>
  Array.from({ length: 60 }, (_, index) => change(index + 1) ?? `const line${index + 1} = 0;`).join(
    '\n',
  ) + '\n';

test('an edit approval card shows its first changed lines as text', async ({ page }) => {
  const markup = "const label = '<img src=x onerror=alert(1)>';";
  await seedChats([
    {
      title: 'Fix invoice totals',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'edit',
        title: 'Edit src/invoice.ts',
        paths: ['src/invoice.ts'],
        diffs: [
          {
            path: 'src/invoice.ts',
            oldText: numbered(() => null),
            newText: numbered((line) => (line >= 20 && line < 23 ? markup : null)),
          },
        ],
      },
    },
  ]);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await page.keyboard.press('Alt+Space');
  const card = island(page).getByRole('group', { name: /wants to change a file/ });
  await expect(card).toBeFocused();
  await expect(card).toContainText('src/invoice.ts');
  const hunk = card.getByRole('region', { name: 'First change to invoice.ts' });
  await expect(hunk).toContainText('const line18 = 0;');
  await expect(hunk).toContainText(markup);
  await expect(hunk.locator('img')).toHaveCount(0);
  await expect(hunk.locator('.dv-row')).toHaveCount(10);
  await expect(hunk).toContainText('1 more line');
  for (const name of [/Deny/, /Allow once/, 'Open chat', 'Later']) {
    await expect(card.getByRole('button', { name })).toBeVisible();
  }
  await page.keyboard.press('Tab');
  await expect(hunk).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('.isl-card').analyze();
  expect(axe.violations).toEqual([]);
  await shot(page, 'approval-hunk');
});

test('an edit approval card for a secret file shows only its path', async ({ page }) => {
  await seedChats([
    {
      title: 'Rotate the token',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'edit',
        title: 'Edit .env',
        paths: ['.env'],
        diffs: [
          {
            path: '.env',
            oldText: 'TOKEN=old-hidden-value\n',
            newText: 'TOKEN=new-hidden-value\n',
          },
        ],
      },
    },
  ]);
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'nudge');
  await page.keyboard.press('Alt+Space');
  const card = island(page).getByRole('group', { name: /wants to change a file/ });
  await expect(card).toContainText('.env');
  await expect(card.getByRole('button', { name: /Allow once/ })).toBeVisible();
  await expect(card.getByRole('region')).toHaveCount(0);
  await expect(card).not.toContainText('hidden-value');
  await shot(page, 'approval-secret');
});
