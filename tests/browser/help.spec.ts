import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SAVED = '/Users/tester/Downloads/spark-outpost-diagnostics-2026-10-01-120000.zip';
const LOGS = '/Users/tester/Library/Application Support/Spark Outpost/logs';

async function fakeDesktop(page: Page, save: 'saved' | 'cancelled' = 'saved') {
  await page.addInitScript(
    ({ saved, logs, outcome }) => {
      const calls: string[] = [];
      const opened: string[] = [];
      const feedbackListeners = new Set<() => void>();
      const noop = () => () => undefined;
      window.open = ((url: string) => {
        opened.push(String(url));
        return null;
      }) as typeof window.open;
      Object.assign(window, {
        helpCalls: calls,
        openedUrls: opened,
        fakeHelp: { openFeedback: () => feedbackListeners.forEach((listener) => listener()) },
        sparkDesktop: {
          platform: 'darwin',
          companion: { get: async () => null, onChange: noop },
          island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
          updates: {
            get: async () => null,
            onChange: noop,
          },
          help: {
            info: async () => ({ version: '0.1.0-beta.1', beta: true, logsFolder: logs }),
            exportDiagnostics: async () => {
              calls.push('export');
              return outcome === 'saved' ? { saved: true, path: saved } : { saved: false };
            },
            showLogs: async () => {
              calls.push('showLogs');
            },
            onOpenFeedback: (listener: () => void) => {
              feedbackListeners.add(listener);
              return () => feedbackListeners.delete(listener);
            },
          },
          onOpenChat: noop,
        },
      });
    },
    { saved: SAVED, logs: LOGS, outcome: save },
  );
}

const read = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((key) => (window as unknown as Record<string, T>)[key]!, name);

async function openHelp(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Help' }).click();
  return page.getByRole('dialog', { name: 'Help' });
}

test('the desktop Help section shows the beta version and logs, and exports diagnostics', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  const help = await openHelp(page);

  await expect(help).toContainText('Spark Outpost 0.1.0-beta.1');
  await expect(help.locator('.beta-badge')).toHaveText('Beta');
  await expect(help).toContainText(LOGS);
  await help.getByRole('button', { name: 'Show in Finder' }).click();

  const exportButton = help.getByRole('button', { name: 'Export diagnostics' });
  await expect(exportButton).toHaveAccessibleDescription(/never holds chats, prompts/);
  await exportButton.click();
  await expect(help).toContainText(`Saved to ${SAVED}.`);
  expect(await read<string[]>(page, 'helpCalls')).toEqual(['showLogs', 'export']);
});

test('the desktop Help section sends the anonymous heartbeat by default and turns it off', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  const help = await openHelp(page);

  const heartbeat = help.getByRole('switch', { name: 'Send anonymous heartbeat' });
  await expect(heartbeat).toBeChecked();
  await expect(heartbeat).toHaveAccessibleDescription(
    'Once a day Spark sends a random install ID, app version and OS. Cloudflare adds the country. No chats, code, names or IP addresses.',
  );
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await heartbeat.click();
  await saved;
  await expect(heartbeat).not.toBeChecked();
  const profile = await page.request.get('/api/setup');
  expect((await profile.json()).profile.heartbeat).toBe(false);
});

test('feedback opens an email draft and says which diagnostics zip to attach', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  const help = await openHelp(page);

  const send = help.getByRole('button', { name: 'Open email draft' });
  await send.click();
  await expect(help.getByLabel('What happened?')).toBeFocused();
  expect(await read<string[]>(page, 'openedUrls')).toEqual([]);

  await help.getByLabel('What happened?').fill('Ship stayed busy after the checks passed.');
  await help.getByLabel('What did you expect?').fill('A pull request link.');
  await help.getByRole('switch', { name: 'Include diagnostics' }).click();
  await send.click();

  await expect(help).toContainText(
    'A draft opened in your email app. Attach spark-outpost-diagnostics-2026-10-01-120000.zip',
  );
  await expect(help).toContainText('Nothing is sent until you send it.');
  const [url] = await read<string[]>(page, 'openedUrls');
  expect(url).toMatch(/^mailto:beta-feedback%40example\.test\?subject=Beta%20feedback/);
  const body = decodeURIComponent(url!.split('&body=')[1]!);
  expect(body).toContain('What happened:\nShip stayed busy after the checks passed.');
  expect(body).toContain('Spark Outpost 0.1.0-beta.1 (Beta)');
  expect(body).toContain('Diagnostics: attached spark-outpost-diagnostics-2026-10-01-120000.zip');
  expect(await read<string[]>(page, 'helpCalls')).toEqual(['export']);
  await expect(help.getByRole('link', { name: 'Open the draft again' })).toHaveAttribute(
    'href',
    url!,
  );
});

test('a cancelled diagnostics save opens no draft', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page, 'cancelled');
  const help = await openHelp(page);
  await help.getByLabel('What happened?').fill('Something odd.');
  await help.getByRole('switch', { name: 'Include diagnostics' }).click();
  await help.getByRole('button', { name: 'Open email draft' }).click();
  await expect(help).toContainText('Diagnostics were not saved, so no draft opened.');
  expect(await read<string[]>(page, 'openedUrls')).toEqual([]);
});

test('Help › Send Feedback in the menu bar opens the form ready to type', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { fakeHelp: { openFeedback(): void } }).fakeHelp.openFeedback(),
  );
  const help = page.getByRole('dialog', { name: 'Help' });
  await expect(help.getByLabel('What happened?')).toBeFocused();
});

test('in the browser, Export diagnostics downloads the zip from the server', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const help = await openHelp(page);
  await expect(help.getByRole('button', { name: 'Show in Finder' })).toHaveCount(0);
  await expect(help.getByRole('switch', { name: 'Send anonymous heartbeat' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await help.getByRole('button', { name: 'Export diagnostics' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^spark-outpost-diagnostics-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/,
  );
  await expect(help).toContainText(
    `Downloaded ${file.suggestedFilename()} to your downloads folder.`,
  );
});
