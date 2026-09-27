import { expect, test, type Page } from '@playwright/test';
import { seedAuditLog, tamperAuditLog } from './audit-seed.ts';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.AUDIT_SCREENSHOTS;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function sendPlannedTask(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 20_000 });
}

const THEMES = [
  'system',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
];

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/s1c-${name}.png` });
}

async function themeShots(page: Page) {
  if (!SHOTS) return;
  for (const theme of THEMES) {
    await page.evaluate((id) => {
      if (id === 'system') delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin = id;
    }, theme);
    await shot(page, `theme-${theme}`);
  }
}

test('the audit view summarises, times, lists, and exports a session', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await sendPlannedTask(page);
  const { runId } = await seedAuditLog();
  await page.reload();

  await expect(page.locator('.run-usage')).toContainText('~$0.004');
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Crew' }).click();
  const crew = panel.getByRole('list', { name: 'Crew' });
  await expect(crew).toContainText('Scout');
  await expect(crew).toContainText('gpt-6-sol · high');
  await expect(crew).toContainText('~$0.004');
  await shot(page, 'crew');
  await panel.getByRole('tab', { name: 'Cost' }).click();
  await expect(panel.locator('.cost-est')).toHaveText('estimated');
  await shot(page, 'cost');

  await panel.getByRole('button', { name: 'Audit this session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Audit this chat' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close audit' })).toBeFocused();
  await expect(dialog.locator('.set-head .chain')).toHaveText('Hash chain verified · 4 events');
  await expect(dialog.locator('.astat').first()).toContainText('~$0.004');
  const byRun = dialog.getByRole('region', { name: 'By run' });
  await expect(byRun).toContainText('Scout');
  await expect(byRun.locator('.srctag.est')).toHaveAttribute('title', /list price/);
  await shot(page, 'summary');

  await dialog.getByRole('tab', { name: 'Summary' }).press('ArrowDown');
  await expect(dialog.getByRole('tab', { name: 'Timeline' })).toBeFocused();
  await expect(dialog.getByRole('figure', { name: 'Turn 1' })).toBeVisible();
  await expect(dialog.locator('.wf-gap')).toHaveCount(1);
  await expect(dialog.locator('.wf-h')).toContainText('waiting for you');
  await shot(page, 'timeline');

  await dialog.getByRole('tab', { name: 'Logs' }).click();
  const rows = dialog.getByRole('list', { name: 'Protocol messages' }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(dialog.locator('.lbar .chain')).toHaveText('Chain verified · 4 events');
  await dialog.getByRole('combobox', { name: 'Direction' }).selectOption('from_agent');
  await expect(rows).toHaveCount(3);
  await dialog.getByRole('combobox', { name: 'Method' }).selectOption('session/update');
  await expect(rows).toHaveCount(1);
  await dialog.getByRole('combobox', { name: 'Method' }).selectOption('');
  await dialog.getByRole('searchbox', { name: 'Filter by text' }).fill('pnpm test');
  await expect(rows).toHaveCount(1);
  const row = rows.first().getByRole('button');
  await expect(row).toContainText('session/request_permission');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(rows.first().locator('pre')).toContainText('"toolCall"');
  await expect(rows.first().locator('.lhash')).toContainText('seq 3');
  await shot(page, 'logs');
  await themeShots(page);
  await dialog.getByRole('searchbox', { name: 'Filter by text' }).fill('nothing like this');
  await expect(dialog.getByText('No messages match.', { exact: false })).toBeVisible();

  await dialog.getByRole('tab', { name: 'Export' }).click();
  const jsonl = dialog.getByRole('link', { name: 'Download .jsonl' });
  await expect(jsonl).toHaveAttribute('href', /\/audit\/export\.jsonl$/);
  await expect(dialog.getByLabel('CSV preview')).toContainText('estimated');
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Download .csv' }).click();
  expect((await download).suggestedFilename()).toMatch(/-cost\.csv$/);
  await shot(page, 'export');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Audit this session' })).toBeFocused();

  await tamperAuditLog(runId);
  await page.reload();
  await page.getByRole('button', { name: 'Chat actions' }).click();
  await page.getByRole('menuitem', { name: 'Audit this chat' }).click();
  await expect(dialog.locator('.set-head .chain')).toHaveText('Hash chain broken in 1 of 1 runs');
  await dialog.getByRole('tab', { name: 'Logs' }).click();
  await expect(dialog.locator('.lbar .chain')).toContainText('Chain broken at #2');
  await shot(page, 'broken');
});

test('the audit view opens from the cost ring and fills a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await sendPlannedTask(page);
  await seedAuditLog();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /Context window/ }).click();
  await expect(page.locator('.ctx-usage')).toContainText('~$0.004');
  await page.getByRole('button', { name: 'Audit this chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'Audit this chat' });
  await expect(dialog).toBeVisible();
  const size = async () => (await dialog.boundingBox()) ?? { width: 0, height: 0 };
  await expect.poll(async () => (await size()).width).toBeGreaterThanOrEqual(389);
  expect((await size()).height).toBeGreaterThanOrEqual(843);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(390);
  await shot(page, 'mobile');
});
