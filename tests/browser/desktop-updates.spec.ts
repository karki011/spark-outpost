import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.SPARK_SHOTS_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `update-${name}.png`) });
}

async function fakeUpdater(page: Page, start: Record<string, unknown> = {}) {
  await page.addInitScript((patch) => {
    const listeners = new Set<(status: unknown) => void>();
    const calls: unknown[][] = [];
    const state = {
      runs: 1,
      status: {
        currentVersion: '0.2.0',
        channel: 'stable',
        autoDownload: true,
        phase: 'idle',
        offReason: null as string | null,
        availableVersion: null as string | null,
        progress: null as number | null,
        installRequested: false,
        waitingForRuns: false,
        lastCheckedAt: null as string | null,
        error: null,
        skippedVersion: null,
        releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html' as string | null,
        ...patch,
      },
    };
    const publish = () => {
      const copy = structuredClone(state.status);
      listeners.forEach((listener) => listener(copy));
      return copy;
    };
    const noop = () => () => undefined;
    const waiting = 'Spark will update when your work finishes.';
    Object.assign(window, {
      desktopCalls: calls,
      fakeUpdates: {
        push: (next: Partial<typeof state.status>) => {
          Object.assign(state.status, next);
          publish();
        },
        setRuns: (runs: number) => {
          state.runs = runs;
        },
      },
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: noop },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: {
          get: async () => structuredClone(state.status),
          check: async () => {
            calls.push(['check']);
            state.status.lastCheckedAt = new Date().toISOString();
            return publish();
          },
          setChannel: async (channel: string) => {
            calls.push(['channel', channel]);
            state.status.channel = channel;
            return publish();
          },
          setAutoDownload: async (on: boolean) => {
            calls.push(['autoDownload', on]);
            state.status.autoDownload = on;
            return publish();
          },
          install: async () => {
            calls.push(['install']);
            if (state.status.phase === 'available') {
              Object.assign(state.status, {
                phase: 'downloading',
                installRequested: true,
                progress: 0,
              });
              publish();
              return { status: 'downloading' };
            }
            if (state.runs > 0) {
              Object.assign(state.status, { installRequested: true, waitingForRuns: true });
              publish();
              return { status: 'waiting', reason: waiting };
            }
            Object.assign(state.status, { phase: 'installing', waitingForRuns: false });
            publish();
            return { status: 'installing' };
          },
          onChange: (listener: (status: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        onOpenChat: noop,
      },
    });
  }, start);
}

async function desktopCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls);
}

async function pushUpdate(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((next) => {
    (window as unknown as { fakeUpdates: { push: (p: unknown) => void } }).fakeUpdates.push(next);
  }, patch);
}

async function setRuns(page: Page, runs: number) {
  await page.evaluate((count) => {
    (window as unknown as { fakeUpdates: { setRuns: (n: number) => void } }).fakeUpdates.setRuns(
      count,
    );
  }, runs);
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('Settings shows the version, channel, automatic downloads and Check now', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });

  await expect(updates).toContainText('Spark Outpost 0.2.0');
  await expect(updates).toContainText('Not checked yet.');
  await expect(updates.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
    'href',
    'https://updates.example.com/spark/release-notes.html',
  );
  await updates.getByRole('radio', { name: 'Beta' }).click();
  await expect(updates.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const auto = updates.getByRole('switch', { name: 'Download updates automatically' });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await expect(updates).toContainText('downloads one when you ask');

  await updates.getByRole('button', { name: 'Check now' }).click();
  await expect(updates).toContainText('Last checked just now.');
  await expect(updates).toContainText("You're up to date.");
  await shot(page, 'settings');

  await pushUpdate(page, { phase: 'downloading', availableVersion: '0.3.0', progress: 42 });
  await expect(updates).toContainText('Downloading 0.3.0… 42%');
  await expect(updates.getByRole('button', { name: 'Checking…' })).toHaveCount(0);
  await expect(updates.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(rail(page).getByRole('button', { name: /0\.3\.0/ })).toHaveCount(0);

  expect(await desktopCalls(page)).toEqual([
    ['channel', 'beta'],
    ['autoDownload', false],
    ['check'],
  ]);
});

test('the update blob goes from available through downloading to ready and restarting', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { autoDownload: false });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(rail(page).getByRole('button', { name: /New update ready/ })).toHaveCount(0);

  await pushUpdate(page, { phase: 'available', availableVersion: '0.3.0' });
  const blob = rail(page).getByRole('button', {
    name: 'New update ready — click to get the latest (Spark Outpost 0.3.0)',
  });
  await expect(blob).toBeVisible();
  await expect(blob.locator('.upd-blob-dot')).toBeVisible();
  await blob.hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'New update ready — click to get the latest',
  );
  await shot(page, 'available');

  await blob.click();
  const downloading = rail(page).getByRole('button', { name: /Getting Spark Outpost 0\.3\.0/ });
  await expect(downloading).toHaveText('0%');
  await pushUpdate(page, { progress: 64 });
  await expect(downloading).toHaveText('64%');
  await expect(downloading).toHaveAttribute('aria-busy', 'true');
  await shot(page, 'downloading');

  await pushUpdate(page, { phase: 'ready', progress: 100, installRequested: false });
  await expect(blob).toBeVisible();
  await expect(page.locator('.upd-toasts').getByRole('status')).toContainText(
    'Spark Outpost 0.3.0 is ready.',
  );
  await shot(page, 'ready');

  await blob.click();
  const waiting = rail(page).getByRole('button', {
    name: 'Spark will update when your work finishes. (Spark Outpost 0.3.0)',
  });
  await expect(waiting).toHaveText('Waiting');
  await expect(
    page.locator('.upd-toasts').getByRole('status').filter({ hasText: 'when your work finishes' }),
  ).toBeVisible();
  await shot(page, 'waiting');

  await setRuns(page, 0);
  await waiting.click();
  const restarting = rail(page).getByRole('button', {
    name: 'Installing Spark Outpost 0.3.0 and restarting',
  });
  await expect(restarting).toHaveText('Restarting');
  await expect(restarting).toBeDisabled();
  await shot(page, 'restarting');

  expect(await desktopCalls(page)).toEqual([['install'], ['install'], ['install']]);
});

test('the ready toast appears once per version', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, { phase: 'ready', availableVersion: '0.3.0', progress: 100 });
  await page.goto('/');
  const toast = page.locator('.upd-toasts').getByRole('status');
  await expect(toast).toContainText('Spark Outpost 0.3.0 is ready.');
  await page.reload();
  await expect(rail(page).getByRole('button', { name: /New update ready/ })).toBeVisible();
  await expect(page.getByText('Spark Outpost 0.3.0 is ready.')).toHaveCount(0);
});

test('the dev copy shows its version, says it never updates and has no blob', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page, {
    currentVersion: '0.0.0',
    phase: 'off',
    offReason: 'dev',
    availableVersion: '9.9.9',
    releaseNotesUrl: null,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText('This dev copy never updates.');
  await expect(updates.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await expect(updates.getByRole('radiogroup', { name: 'Update channel' })).toHaveCount(0);
  await expect(rail(page).getByRole('button', { name: /New update ready/ })).toHaveCount(0);
});

test('the browser build has no Updates section and no update blob', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('tab', { name: 'Reset' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Updates' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New update ready/ })).toHaveCount(0);
});
