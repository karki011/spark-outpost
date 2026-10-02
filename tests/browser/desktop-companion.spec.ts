import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

async function fakeDesktop(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<(status: unknown) => void>();
    const calls: unknown[][] = [];
    const status = {
      supported: true,
      enabled: false,
      shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
      failed: [] as string[],
    };
    const publish = () => {
      const copy = structuredClone(status);
      listeners.forEach((listener) => listener(copy));
      return copy;
    };
    const noop = () => () => undefined;
    Object.assign(window, {
      desktopCalls: calls,
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => structuredClone(status),
          setEnabled: async (on: boolean) => {
            calls.push(['enabled', on]);
            status.enabled = on;
            return publish();
          },
          setShortcut: async (action: 'quick' | 'sessions', accelerator: string | null) => {
            calls.push(['shortcut', action, accelerator]);
            if (accelerator === 'Alt+K')
              return {
                ok: false,
                error: 'Another app is using this shortcut. Pick a different one.',
              };
            status.shortcuts[action] =
              accelerator ?? (action === 'quick' ? 'Alt+Space' : 'Alt+Shift+Space');
            publish();
            return { ok: true };
          },
          onChange: (listener: (status: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        onOpenChat: noop,
      },
    });
  });
}

test('the desktop companion shows its shortcuts only while it is on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  const toggle = spark.getByRole('switch', { name: 'Show Spark Island' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(spark.getByRole('button', { name: 'Change Quick chat shortcut' })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const change = spark.getByRole('button', { name: 'Change Quick chat shortcut' });
  await change.click();
  await page.keyboard.press('Control+Alt+J');
  await expect(spark.getByRole('button', { name: 'Reset Quick chat shortcut' })).toBeEnabled();
  await spark.getByRole('button', { name: 'Change Sessions shortcut' }).click();
  await page.keyboard.press('Alt+K');
  await expect(spark).toContainText('Another app is using this shortcut.');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(spark.getByRole('button', { name: 'Change Quick chat shortcut' })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls),
  ).toEqual([
    ['enabled', true],
    ['shortcut', 'quick', 'Control+Alt+J'],
    ['shortcut', 'sessions', 'Alt+K'],
    ['enabled', false],
  ]);
});

test('the browser build hides the desktop companion settings', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const spark = page.getByRole('dialog', { name: 'Spark' });
  await expect(spark.getByRole('radiogroup', { name: 'Status companion' })).toBeVisible();
  await expect(spark.getByRole('switch', { name: 'Show Spark Island' })).toHaveCount(0);
});
