import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

async function fakeUpdater(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<(status: unknown) => void>();
    const calls: unknown[][] = [];
    const state = {
      blockInstall: true,
      status: {
        currentVersion: '0.2.0',
        channel: 'stable',
        phase: 'idle',
        offReason: null,
        availableVersion: null as string | null,
        progress: null as number | null,
        lastCheckedAt: null as string | null,
        error: null,
        skippedVersion: null,
        releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html',
      },
    };
    const publish = () => {
      const copy = structuredClone(state.status);
      listeners.forEach((listener) => listener(copy));
      return copy;
    };
    const noop = () => () => undefined;
    Object.assign(window, {
      desktopCalls: calls,
      fakeUpdates: {
        push: (patch: Partial<typeof state.status>) => {
          Object.assign(state.status, patch);
          publish();
        },
        allowInstall: () => {
          state.blockInstall = false;
        },
      },
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => null,
          onChange: noop,
        },
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
          install: async () => {
            calls.push(['install']);
            return state.blockInstall
              ? {
                  started: false,
                  reason: '1 run is still working. Restart once they finish or you stop them.',
                }
              : { started: true };
          },
          onChange: (listener: (status: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        onOpenChat: noop,
      },
    });
  });
}

async function desktopCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls);
}

async function pushUpdate(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((next) => {
    (window as unknown as { fakeUpdates: { push: (p: unknown) => void } }).fakeUpdates.push(next);
  }, patch);
}

test('Settings shows the version, switches channel and checks for updates', async ({ page }) => {
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
  const stable = updates.getByRole('radio', { name: 'Stable' });
  await expect(stable).toHaveAttribute('aria-checked', 'true');
  await updates.getByRole('radio', { name: 'Beta' }).click();
  await expect(updates.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(updates).toContainText('New features a little earlier');

  await updates.getByRole('button', { name: 'Check now' }).click();
  await expect(updates).toContainText('Last checked just now.');
  await expect(updates).toContainText("You're up to date.");

  await pushUpdate(page, { phase: 'downloading', availableVersion: '0.3.0', progress: 42 });
  await expect(updates).toContainText('Downloading 0.3.0… 42%');
  await expect(updates.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Update ready/ })).toHaveCount(0);

  expect(await desktopCalls(page)).toEqual([['channel', 'beta'], ['check']]);
});

test('a ready update shows a quiet chip and one toast, and never restarts over running work', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await pushUpdate(page, { phase: 'ready', availableVersion: '0.3.0', progress: 100 });

  const chip = page.getByRole('button', {
    name: 'Update ready: restart to install Spark Outpost 0.3.0',
  });
  await expect(chip).toBeVisible();
  const toast = page.locator('.upd-toasts').getByRole('status');
  await expect(toast.filter({ hasText: 'Spark Outpost 0.3.0 is ready.' })).toBeVisible();

  await chip.click();
  await expect(toast.filter({ hasText: '1 run is still working.' })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { fakeUpdates: { allowInstall: () => void } }).fakeUpdates.allowInstall(),
  );
  await chip.click();
  expect(await desktopCalls(page)).toEqual([['install'], ['install']]);

  await page.reload();
  await pushUpdate(page, { phase: 'ready', availableVersion: '0.3.0', progress: 100 });
  await expect(chip).toBeVisible();
  await expect(page.getByText('Spark Outpost 0.3.0 is ready.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText('0.3.0 is ready.');
  await expect(updates.getByRole('button', { name: 'Restart to update' })).toBeVisible();
});

test('the dev copy shows its version and says it never updates', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeUpdater(page);
  await page.addInitScript(() => {
    const desktop = (
      window as unknown as { sparkDesktop: { updates: { get: () => Promise<unknown> } } }
    ).sparkDesktop;
    const original = desktop.updates.get;
    desktop.updates.get = async () => ({
      ...((await original()) as object),
      currentVersion: '0.0.0',
      phase: 'off',
      offReason: 'dev',
      releaseNotesUrl: null,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates).toContainText('This dev copy never updates.');
  await expect(updates.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  await expect(updates.getByRole('radiogroup', { name: 'Update channel' })).toHaveCount(0);
});

test('the browser build has no Updates section and no update chip', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('tab', { name: 'Reset' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Updates' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Update ready/ })).toHaveCount(0);
});
