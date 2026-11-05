import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openBrowserView } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { calls } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const entry = (change: Record<string, unknown>) => ({
  id: 'd1',
  filename: 'report.pdf',
  host: 'files.example.com',
  where: 'personal',
  by: 'you',
  state: 'saved',
  receivedBytes: 2048,
  totalBytes: 2048,
  at: '2026-10-23T12:00:00Z',
  ...change,
});

async function push(page: Page, list: unknown[]) {
  await page.evaluate(
    (sent) =>
      (window as unknown as { browserDownloadsPush: (l: unknown[]) => void }).browserDownloadsPush(
        sent,
      ),
    list,
  );
}

test('Downloads lists what you saved and what an agent was refused, with actions', async ({
  page,
}) => {
  const side = await openBrowserView(page);
  await push(page, [
    entry({ id: 'd3', filename: 'big.zip', state: 'saving', receivedBytes: 512, totalBytes: 1024 }),
    entry({ id: 'd2', filename: 'payload.sh', by: 'agent', state: 'blocked', where: 'chat' }),
    entry({}),
  ]);
  const downloads = side.getByRole('region', { name: 'Downloads' });
  const toggle = downloads.getByRole('button', { name: /Downloads/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const rows = downloads.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Saving · 50%');
  await expect(rows.nth(1)).toContainText('Not saved: an agent’s action started it');
  await expect(rows.nth(1).getByRole('button')).toHaveCount(0);
  await expect(rows.nth(2)).toContainText('Saved · 2 KB · files.example.com · Personal');

  await downloads.getByRole('button', { name: 'Cancel big.zip' }).click();
  await downloads.getByRole('button', { name: 'Show report.pdf in Finder' }).click();
  await expect
    .poll(() => calls(page, 'download-act'))
    .toEqual([
      { id: 'd3', action: 'cancel' },
      { id: 'd1', action: 'show' },
    ]);

  const results = await new AxeBuilder({ page }).include('.bv-dls').analyze();
  expect(results.violations).toEqual([]);
});
