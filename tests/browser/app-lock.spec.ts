import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island } from './island-home-desktop.ts';
import { clickSettings } from './rail-menu.ts';
import { animationsSettled } from './settle.ts';

const CODE = '246810';
const THEMES = ['light', 'graphite'] as const;

interface FakeLock {
  locked?: boolean;
  enabled?: boolean;
  hasCode?: boolean;
  touchId?: boolean;
  touchIdAvailable?: boolean;
  recoveryAvailable?: boolean;
}

interface LockWindow {
  lockCalls: unknown[][];
  lockFake: {
    lock(): void;
    waitOnNextMiss(): void;
    endWait(): void;
    acceptTouch(): void;
    recoverWith(result: 'ok' | 'cancelled' | 'failed'): void;
  };
}

async function fakeDesktop(page: Page, start: FakeLock = {}) {
  await page.addInitScript(
    ({ start, code }) => {
      const listeners = new Set<(status: unknown) => void>();
      const calls: unknown[][] = [];
      const status = {
        enabled: true,
        locked: false,
        hasCode: true,
        idleMinutes: 5,
        onSleep: true,
        touchId: false,
        touchIdAvailable: false,
        hideNotifications: true,
        retryAt: null as number | null,
        recoveryAvailable: false,
        ...start,
      };
      let saved = code;
      let waitOnMiss = false;
      let touchWorks = false;
      let recovery = 'cancelled';
      const publish = () => {
        const copy = structuredClone(status);
        listeners.forEach((listener) => listener(copy));
        return copy;
      };
      const noop = () => () => undefined;
      Object.assign(window, {
        lockCalls: calls,
        lockFake: {
          lock: () => {
            status.locked = true;
            publish();
          },
          waitOnNextMiss: () => {
            waitOnMiss = true;
          },
          endWait: () => {
            status.retryAt = null;
            publish();
          },
          acceptTouch: () => {
            touchWorks = true;
          },
          recoverWith: (result: string) => {
            recovery = result;
          },
        },
        sparkDesktop: {
          platform: 'darwin',
          companion: { get: async () => null, onChange: noop },
          island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
          updates: { get: async () => null, onChange: noop },
          onOpenChat: noop,
          ...(window as { sparkDesktop?: object }).sparkDesktop,
          lock: {
            recover: async () => {
              calls.push(['recover']);
              if (recovery !== 'ok') return { ok: false, reason: recovery };
              saved = '';
              Object.assign(status, { hasCode: false, enabled: false, locked: false });
              publish();
              return { ok: true };
            },
            status: async () => structuredClone(status),
            onChange: (listener: (status: unknown) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            lockNow: async () => {
              calls.push(['lockNow']);
              status.locked = true;
              publish();
            },
            unlockWithTouchId: async () => {
              calls.push(['touch']);
              if (touchWorks) {
                status.locked = false;
                publish();
              }
              return touchWorks;
            },
            unlockWithCode: async (typed: string) => {
              calls.push(['code', typed]);
              if (typed === saved && status.retryAt === null) {
                status.locked = false;
                publish();
                return { ok: true, retryAt: null };
              }
              if (waitOnMiss) status.retryAt = Date.now() + 60_000;
              publish();
              return { ok: false, retryAt: status.retryAt };
            },
            setCode: async (input: { current?: string; next: string; enable?: boolean }) => {
              calls.push(['setCode', input]);
              if (status.hasCode && input.current !== saved) return { ok: false };
              saved = input.next;
              status.hasCode = true;
              if (input.enable === true) status.enabled = true;
              publish();
              return { ok: true };
            },
            set: async (patch: Record<string, unknown>) => {
              calls.push(['set', patch]);
              Object.assign(status, patch);
              return publish();
            },
          },
        },
      });
    },
    { start, code: CODE },
  );
}

const lockCalls = (page: Page) => page.evaluate(() => (window as unknown as LockWindow).lockCalls);

const overlay = (page: Page) => page.getByRole('dialog', { name: 'Spark Outpost is locked' });

const railLock = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Lock Spark Outpost' });

const focusInOverlay = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('.lock-host') !== null);

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a locked app is hidden, out of reach, and opens with the right code', async ({ page }) => {
  await fakeDesktop(page);
  await page.goto('/');
  const more = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^More/ });
  await more.focus();
  await expect(more).toBeFocused();

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.lock());
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toContainText('Your chats keep running.');
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unlock with Touch ID' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Forgot code?' })).toHaveCount(0);

  const code = page.getByLabel('Enter your code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(code).toHaveAttribute('autocomplete', 'off');
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInOverlay(page)).toBe(true);
  }
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await code.focus();
  await page.keyboard.type('111111');
  await expect(page.getByRole('alert')).toHaveText('Wrong code');
  await expect(code).toHaveValue('');
  await expect(code).toBeEnabled();
  expect(await lockCalls(page)).toEqual([['code', '111111']]);

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.waitOnNextMiss());
  await code.fill('22 22-22');
  await expect(code).toBeDisabled();
  await expect(overlay(page)).toContainText(/Try again in \d+ s/);
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Enter your code')).toBeDisabled();
  expect((await lockCalls(page)).at(-1)).toEqual(['code', '222222']);

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.endWait());
  await expect(code).toBeEnabled();
  await expect(code).toBeFocused();
  await code.fill(CODE);
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await expect(more).toBeVisible();
  await expect(more).toBeFocused();
});

test('Touch ID asks once by itself, then from its button, with the code one step away', async ({
  page,
}) => {
  await fakeDesktop(page, { locked: true, touchId: true, touchIdAvailable: true });
  await page.goto('/');
  await expect(overlay(page)).toBeVisible();
  const touch = page.getByRole('button', { name: 'Unlock with Touch ID' });
  await expect(touch).toBeFocused();
  await expect(overlay(page).getByRole('status')).toContainText('Touch ID didn’t unlock Spark');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await lockCalls(page)).toEqual([['touch']]);

  await page.getByRole('button', { name: 'Enter code instead' }).click();
  await expect(page.getByLabel('Enter your code')).toBeFocused();
  await expect(touch).toHaveCount(0);
  await page.getByRole('button', { name: 'Use Touch ID' }).click();
  await expect(touch).toBeFocused();
  expect(await lockCalls(page)).toEqual([['touch']]);

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.acceptTouch());
  await touch.click();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  expect(await lockCalls(page)).toEqual([['touch'], ['touch']]);
});

test('turning the privacy screen on asks for a code first', async ({ page }) => {
  await fakeDesktop(page, { enabled: false, hasCode: false, touchIdAvailable: false });
  await page.goto('/');
  await clickSettings(page);
  const settings = page.getByRole('dialog', { name: 'General' });
  const away = settings.getByRole('switch', { name: /^Lock Spark when I.m away$/ });
  await expect(away).not.toBeChecked();
  await expect(settings.getByRole('button', { name: 'Change code…' })).toHaveCount(0);
  await away.click();

  const sheet = page.getByRole('dialog', { name: 'Set a code' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('New code', { exact: true })).toBeFocused();
  await page.keyboard.type(CODE);
  await expect(sheet.getByLabel('New code again')).toBeFocused();
  await page.keyboard.type('246811');
  await sheet.getByRole('button', { name: 'Set code' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('The codes don’t match.');
  expect(await lockCalls(page)).toEqual([]);

  await sheet.getByLabel('New code again').fill(CODE);
  await sheet.getByRole('button', { name: 'Set code' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(away).toBeChecked();
  expect(await lockCalls(page)).toEqual([['setCode', { next: CODE, enable: true }]]);

  await expect(settings.getByRole('radiogroup', { name: 'Lock after' })).toBeVisible();
  await expect(settings.getByText('No mouse or keys on this Mac')).toBeVisible();
  const touch = settings.getByRole('switch', { name: 'Unlock with Touch ID' });
  await expect(touch).toBeDisabled();
  await expect(settings.getByText('This Mac has no Touch ID')).toBeVisible();
  await settings.getByRole('radio', { name: '15 min' }).click();
  expect((await lockCalls(page)).at(-1)).toEqual(['set', { idleMinutes: 15 }]);

  await settings.getByRole('button', { name: 'Change code…' }).click();
  const change = page.getByRole('dialog', { name: 'Change code' });
  await change.getByLabel('Current code').fill('000000');
  await change.getByLabel('New code', { exact: true }).fill('135790');
  await change.getByLabel('New code again').fill('135790');
  await change.getByRole('button', { name: 'Change code' }).click();
  await expect(change.getByRole('alert')).toHaveText('That isn’t your current code.');
  await change.getByLabel('Current code').fill(CODE);
  await change.getByRole('button', { name: 'Change code' }).click();
  await expect(change).toHaveCount(0);
});

test('the privacy screen is not offered without the Mac app', async ({ page }) => {
  await page.goto('/');
  await clickSettings(page);
  const settings = page.getByRole('dialog', { name: 'General' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Privacy screen' })).toHaveCount(0);
  await expect(railLock(page)).toHaveCount(0);
});

test('the left bar locks at once, and the blob follows what you type', async ({ page }) => {
  await fakeDesktop(page);
  await page.goto('/');
  await expect(railLock(page)).toHaveAttribute(
    'title',
    /^Lock Spark Outpost · (⇧ ?⌘ ?L|Ctrl Shift L)$/,
  );
  await railLock(page).click();
  await expect(overlay(page)).toBeVisible();
  expect(await lockCalls(page)).toEqual([['lockNow']]);

  const blob = page.locator('.lock-blob');
  const code = page.getByLabel('Enter your code');
  await expect(blob).toHaveAttribute('aria-hidden', 'true');
  await expect(blob).toHaveAttribute('data-pose', 'asleep');
  await page.keyboard.type('1');
  await expect(blob).toHaveAttribute('data-pose', 'awake');
  await expect(blob).toHaveAttribute('data-beat', 'odd');
  await page.keyboard.type('2');
  await expect(blob).toHaveAttribute('data-beat', 'even');
  await page.keyboard.type('3456');
  await expect(blob).toHaveAttribute('data-pose', 'no');
  await expect(blob).toHaveAttribute('data-pose', 'asleep');

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.waitOnNextMiss());
  await code.fill('222222');
  await expect(blob).toHaveAttribute('data-pose', 'no');
  await expect(blob).toHaveAttribute('data-pose', 'sulk');
  await expect(overlay(page)).toContainText(/Try again in \d+ s/);

  await page.evaluate(() => (window as unknown as LockWindow).lockFake.endWait());
  await expect(blob).toHaveAttribute('data-pose', 'asleep');
  await code.fill(CODE);
  await expect(blob).toHaveAttribute('data-pose', 'happy');
  await expect(overlay(page)).toHaveCount(0);
  await expect(railLock(page)).toBeFocused();
});

test('the left bar lock opens the privacy screen settings until a code is set', async ({
  page,
}) => {
  await fakeDesktop(page, { enabled: false, hasCode: false });
  await page.goto('/');
  await expect(railLock(page)).toHaveAttribute('title', 'Set up the privacy screen');
  await railLock(page).click();
  const settings = page.getByRole('dialog', { name: 'General' });
  await expect(settings.getByRole('heading', { name: 'Privacy screen' })).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  expect(await lockCalls(page)).toEqual([]);
});

const useFake = (page: Page, result: 'ok' | 'cancelled' | 'failed') =>
  page.evaluate((value) => (window as unknown as LockWindow).lockFake.recoverWith(value), result);

test('a forgotten code is reset with the Mac password and leaves a note in Settings', async ({
  page,
}) => {
  await fakeDesktop(page, { locked: true, recoveryAvailable: true });
  await page.goto('/');
  const forgot = page.getByRole('button', { name: 'Forgot code?' });
  const confirm = page.getByRole('dialog', { name: 'Reset your code?' });
  const useMac = page.getByRole('button', { name: 'Use Mac password…' });
  await forgot.click();
  await expect(confirm).toContainText('Confirm with your Mac password or Touch ID.');
  await expect(useMac).toBeFocused();
  await useMac.click();
  await expect(overlay(page)).toBeVisible();
  await expect(page.getByLabel('Enter your code')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('');

  await forgot.click();
  await useFake(page, 'failed');
  await useMac.click();
  await expect(page.getByRole('alert')).toHaveText('Couldn’t confirm it’s you. Try again.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(overlay(page)).toBeVisible();

  await forgot.click();
  await useFake(page, 'ok');
  await useMac.click();
  await expect(page.locator('.lock-host')).toHaveCount(0);
  const settings = page.getByRole('dialog', { name: 'General' });
  const note = settings.getByText(
    'Your code was reset. Set a new one to turn the privacy screen back on.',
  );
  await expect(note).toBeVisible();
  const away = settings.getByRole('switch', { name: /^Lock Spark when I.m away$/ });
  await expect(away).not.toBeChecked();
  await away.click();
  const sheet = page.getByRole('dialog', { name: 'Set a code' });
  await sheet.getByLabel('New code', { exact: true }).fill(CODE);
  await sheet.getByLabel('New code again').fill(CODE);
  await sheet.getByRole('button', { name: 'Set code' }).click();
  await expect(away).toBeChecked();
  await expect(note).toHaveCount(0);
  expect(await lockCalls(page)).toEqual([
    ['recover'],
    ['recover'],
    ['recover'],
    ['setCode', { next: CODE, enable: true }],
  ]);
});

test('Change code offers Forgot code? and then asks only for a new one', async ({ page }) => {
  await fakeDesktop(page, { recoveryAvailable: true });
  await page.goto('/');
  await clickSettings(page);
  const settings = page.getByRole('dialog', { name: 'General' });
  await settings.getByRole('button', { name: 'Change code…' }).click();
  const change = page.getByRole('dialog', { name: 'Change code' });
  await useFake(page, 'failed');
  await change.getByRole('button', { name: 'Forgot code?' }).click();
  await expect(change.getByRole('alert')).toHaveText('Couldn’t confirm it’s you. Try again.');
  await useFake(page, 'ok');
  await change.getByRole('button', { name: 'Forgot code?' }).click();
  const fresh = page.getByRole('dialog', { name: 'Set a code' });
  await expect(fresh.getByLabel('Current code')).toHaveCount(0);
  await expect(fresh.getByLabel('New code', { exact: true })).toBeFocused();
  await fresh.getByLabel('New code', { exact: true }).fill('135790');
  await fresh.getByLabel('New code again').fill('135790');
  await fresh.getByRole('button', { name: 'Set code' }).click();
  await expect(fresh).toHaveCount(0);
  expect((await lockCalls(page)).at(-1)).toEqual(['setCode', { next: '135790', enable: true }]);
});

test('the lock is also in the More sheet, the Settings window and the island', async ({
  page,
  context,
}) => {
  await fakeDesktop(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^More/ })
    .click();
  await page
    .getByRole('group', { name: 'More destinations' })
    .getByRole('button', { name: 'Lock Spark Outpost' })
    .click();
  await expect(overlay(page)).toBeVisible();
  expect(await lockCalls(page)).toEqual([['lockNow']]);

  const settings = await context.newPage();
  await fakeDesktop(settings);
  await settings.goto('/settings');
  const inSettings = settings.getByRole('button', { name: 'Lock Spark Outpost' });
  await expect(inSettings).toHaveAttribute('title', /(⇧ ?⌘ ?L|Ctrl Shift L)$/);
  await inSettings.click();
  await expect(overlay(settings)).toBeVisible();

  const isl = await context.newPage();
  await fakeHomeDesktop(isl, 'light');
  await fakeDesktop(isl);
  await isl.setViewportSize({ width: 1280, height: 720 });
  await isl.goto('/island');
  await isl.mouse.move(640, 600);
  await island(isl)
    .getByRole('button', { name: /Open Spark Island/ })
    .first()
    .click();
  await island(isl).getByRole('button', { name: 'Lock Spark Outpost' }).click();
  expect(await lockCalls(isl)).toEqual([['lockNow']]);
  await expect(island(isl)).toHaveCount(0);
});

test('the lock screen has no accessibility violations in light and dark', async ({ page }) => {
  await fakeDesktop(page, { locked: true, touchId: true, touchIdAvailable: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(overlay(page)).toBeVisible();
  const check = async () => {
    await animationsSettled(page);
    const results = await new AxeBuilder({ page })
      .include('.lock-host')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  for (const skin of THEMES) {
    await page.locator('html').evaluate((html, value) => (html.dataset.skin = value), skin);
    await check();
    await page.getByRole('button', { name: 'Enter code instead' }).click();
    await page.getByLabel('Enter your code').fill('111111');
    await expect(page.getByRole('alert')).toHaveText('Wrong code');
    await check();
    await page.getByRole('button', { name: 'Use Touch ID' }).click();
  }
});
