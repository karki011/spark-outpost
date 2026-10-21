import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { island, openIsland } from './island-home-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_CODE_SHOTS ?? '';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(SHOTS, `island-code-${name}.png`),
    clip: { x: 180, y: 0, width: 920, height: 460 },
  });
}

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
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(island(page).getByLabel('1 need you', { exact: true })).toHaveText('1');
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
  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(island(page).getByLabel('1 need you', { exact: true })).toHaveText('1');
  await page.keyboard.press('Alt+Space');
  const card = island(page).getByRole('group', { name: /wants to change a file/ });
  await expect(card).toContainText('.env');
  await expect(card.getByRole('button', { name: /Allow once/ })).toBeVisible();
  await expect(card.getByRole('region')).toHaveCount(0);
  await expect(card).not.toContainText('hidden-value');
  await shot(page, 'approval-secret');
});
