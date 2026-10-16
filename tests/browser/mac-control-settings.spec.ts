import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

async function fakeDesktop(page: Page, indicator: unknown = null) {
  await page.addInitScript((shown) => {
    const calls: string[] = [];
    let trusted = false;
    const noop = () => () => undefined;
    const status = () => ({ supported: true, trusted, helper: 'ready' });
    Object.assign(window, {
      macCalls: calls,
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: noop },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: { get: async () => null, onChange: noop },
        macControl: {
          status: async () => status(),
          prompt: async () => {
            calls.push('prompt');
            trusted = true;
            return status();
          },
          openSettings: async () => {
            calls.push('openSettings');
          },
          stop: async () => {
            calls.push('stop');
          },
          resume: async () => {
            calls.push('resume');
          },
          indicator: async () => shown,
          onIndicator: noop,
        },
        onOpenChat: noop,
      },
    });
  }, indicator);
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { macCalls: string[] }).macCalls);

test('Mac control is not offered without the Mac app', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Profile & personality' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Mac control' })).toHaveCount(0);
});

test('Mac control starts off, saves the switch and asks macOS for Accessibility', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Mac control' }).click();
  const settings = page.getByRole('dialog', { name: 'Mac control' });
  const toggle = settings.getByRole('switch', { name: 'Let agents control other Mac apps' });
  await expect(toggle).not.toBeChecked();
  await expect(settings.getByText('Off. Agents can’t see or use other apps.')).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await toggle.focus();
  await page.keyboard.press('Space');
  await saved;
  await expect(toggle).toBeChecked();
  await expect
    .poll(async () => (await (await page.request.get('/api/setup')).json()).profile)
    .toMatchObject({ macControl: true });
  const card = settings.getByRole('region', { name: 'Accessibility' });
  await expect(card.getByText('Not yet')).toBeVisible();
  await card.getByRole('button', { name: 'Open Accessibility settings' }).click();
  await card.getByRole('button', { name: 'Ask macOS' }).click();
  await expect(card.getByText('Allowed')).toBeVisible();
  expect(await calls(page)).toEqual(['openSettings', 'prompt']);
});

test('the indicator names the app, and Stop and Resume reach the shell', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page, { app: 'Calculator', did: 'Pressed button "7"', paused: true });
  await page.goto('/mac-indicator');
  const status = page.getByRole('status');
  await expect(status).toContainText('Paused: you took over Calculator');
  await status.getByRole('button', { name: 'Resume' }).click();
  await status.getByRole('button', { name: 'Stop' }).click();
  expect(await calls(page)).toEqual(['resume', 'stop']);
});
