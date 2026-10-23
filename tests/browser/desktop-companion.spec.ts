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
      sound: false,
      islandSize: localStorage.getItem('fake-desktop.island-size') ?? 'medium',
      autoExpand: true,
      hideInShare: true,
      notify: true,
      notifyBlocked: false,
      menuBar: false,
    };
    const publish = () => {
      const copy = structuredClone(status);
      listeners.forEach((listener) => listener(copy));
      return copy;
    };
    const noop = () => () => undefined;
    const reports: unknown[] = [];
    Object.assign(window, {
      desktopCalls: calls,
      attentionReports: reports,
      blockNotifications: () => {
        status.notifyBlocked = true;
        publish();
      },
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
          setSound: async (on: boolean) => {
            calls.push(['sound', on]);
            status.sound = on;
            return publish();
          },
          setIslandSize: async (size: string) => {
            calls.push(['size', size]);
            status.islandSize = size;
            localStorage.setItem('fake-desktop.island-size', size);
            return publish();
          },
          setAutoExpand: async (on: boolean) => {
            calls.push(['autoExpand', on]);
            status.autoExpand = on;
            return publish();
          },
          setHideInShare: async (on: boolean) => {
            calls.push(['hideInShare', on]);
            status.hideInShare = on;
            return publish();
          },
          setNotify: async (on: boolean) => {
            calls.push(['notify', on]);
            status.notify = on;
            return publish();
          },
          setMenuBar: async (on: boolean) => {
            calls.push(['menuBar', on]);
            status.menuBar = on;
            return publish();
          },
          onChange: (listener: (status: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        attention: { report: (report: unknown) => reports.push(report) },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        onOpenChat: noop,
        onOpenSettings: (callback: (target: string) => void) => {
          Object.assign(window, { openFromIsland: callback });
          return () => undefined;
        },
      },
    });
  });
}

async function openNotifications(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Notifications' })
    .click();
}

const desktopCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls);

test('the desktop companion shows its shortcuts only while it is on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await openNotifications(page);
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  const toggle = spark.getByRole('switch', { name: 'Show Spark Island' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(spark.getByRole('button', { name: 'Change Quick chat shortcut' })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const sizes = spark.getByRole('radiogroup', { name: 'Spark Island size' });
  await expect(sizes.getByRole('radio', { name: 'Medium' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await sizes.getByRole('radio', { name: 'Large', exact: true }).click();
  await expect(sizes.getByRole('radio', { name: 'Large', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(sizes.getByRole('radio')).toHaveText([
    'Full',
    'Small',
    'Medium',
    'Large',
    'Extra large',
  ]);
  await sizes.getByRole('radio', { name: 'Extra large' }).click();
  expect(await desktopCalls(page)).toEqual([
    ['enabled', true],
    ['size', 'large'],
    ['size', 'xlarge'],
  ]);
  await page.reload();
  await openNotifications(page);
  await toggle.click();
  await expect(sizes.getByRole('radio', { name: 'Extra large' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const change = spark.getByRole('button', { name: 'Change Quick chat shortcut' });
  await change.click();
  await page.keyboard.press('Control+Alt+J');
  await expect(spark.getByRole('button', { name: 'Reset Quick chat shortcut' })).toBeEnabled();
  await spark.getByRole('button', { name: 'Change Inbox shortcut' }).click();
  await page.keyboard.press('Alt+K');
  await expect(spark).toContainText('Another app is using this shortcut.');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(spark.getByRole('button', { name: 'Change Quick chat shortcut' })).toHaveCount(0);
  expect(await desktopCalls(page)).toEqual([
    ['enabled', true],
    ['shortcut', 'quick', 'Control+Alt+J'],
    ['shortcut', 'sessions', 'Alt+K'],
    ['enabled', false],
  ]);
});

test('the browser build hides the desktop companion settings', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await openNotifications(page);
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  await expect(spark.getByRole('radiogroup', { name: 'Status companion' })).toBeVisible();
  await expect(spark.getByRole('switch', { name: 'Show Spark Island' })).toHaveCount(0);
  await expect(spark.getByRole('switch', { name: 'Dock badge and notifications' })).toHaveCount(0);
  await expect(spark.getByRole('switch', { name: 'Show in menu bar' })).toHaveCount(0);
});

test('the menu bar item stays off until switched on, with or without the island', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('menu bar');
  await expect(page.getByRole('option')).toHaveText([/^Show in menu bar/]);
  await search.press('Enter');
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  const menuBar = spark.getByRole('switch', { name: 'Show in menu bar' });
  await expect(menuBar).toBeFocused();
  await expect(menuBar).toHaveAttribute('aria-checked', 'false');
  await expect(spark.getByRole('switch', { name: 'Show Spark Island' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(spark).toContainText('Open Spark from the Dock');
  await page.keyboard.press('Space');
  await expect(menuBar).toHaveAttribute('aria-checked', 'true');
  await expect(spark).toContainText('A Spark icon in the menu bar opens Spark');
  await spark.getByRole('switch', { name: 'Show Spark Island' }).click();
  await expect(menuBar).toHaveAttribute('aria-checked', 'true');
  await menuBar.click();
  await expect(menuBar).toHaveAttribute('aria-checked', 'false');
  expect(await desktopCalls(page)).toEqual([
    ['menuBar', true],
    ['enabled', true],
    ['menuBar', false],
  ]);
});

test('searching an island row while the island is off focuses Show Spark Island', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('island chimes');
  await expect(page.getByRole('option')).toHaveText([/^Island chimes/]);
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Notifications' });
  const show = dialog.getByRole('switch', { name: 'Show Spark Island' });
  await expect(show).toBeFocused();
  await expect(dialog.locator('.set-row[data-found]')).toContainText('Show Spark Island');
  await search.fill('quick chat');
  await search.press('Enter');
  await expect(show).toBeFocused();
  await show.click();
  await expect(dialog.getByRole('switch', { name: 'Island chimes' })).toBeVisible();
  await expect(show).toBeFocused();
});

test('the Dock badge and notifications switch works with the island off', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { attentionReports: unknown[] }).attentionReports),
    )
    .toEqual([{ count: 0, requests: [] }]);
  await openNotifications(page);
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  await expect(spark.getByRole('switch', { name: 'Show Spark Island' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const notify = spark.getByRole('switch', { name: 'Dock badge and notifications' });
  await expect(notify).toHaveAttribute('aria-checked', 'true');
  await expect(spark).toContainText('a notification names the chat');
  await page.evaluate(() =>
    (window as unknown as { blockNotifications: () => void }).blockNotifications(),
  );
  await expect(spark).toContainText('System Settings → Notifications');
  await notify.focus();
  await page.keyboard.press('Space');
  await expect(notify).toHaveAttribute('aria-checked', 'false');
  await expect(spark).toContainText('No Dock count');
  expect(await desktopCalls(page)).toEqual([['notify', false]]);
});

test('the island opens these settings, and its chimes stay off until switched on', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeDesktop(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  const fromIsland = (target: string) =>
    page.evaluate(
      (target) =>
        (window as unknown as { openFromIsland: (target: string) => void }).openFromIsland(target),
      target,
    );
  await fromIsland('island');
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  const show = spark.getByRole('switch', { name: 'Show Spark Island' });
  await expect(show).toBeFocused();
  await expect(spark.getByRole('switch', { name: 'Island chimes' })).toHaveCount(0);
  await show.click();
  const chimes = spark.getByRole('switch', { name: 'Island chimes' });
  await expect(chimes).toHaveAttribute('aria-checked', 'false');
  await chimes.click();
  await expect(chimes).toHaveAttribute('aria-checked', 'true');
  await expect(spark).toContainText('plays a soft chime');
  const sizes = spark.getByRole('radiogroup', { name: 'Spark Island size' });
  await expect(sizes.getByRole('radio')).toHaveText([
    'Full',
    'Small',
    'Medium',
    'Large',
    'Extra large',
  ]);
  await sizes.getByRole('radio', { name: 'Full' }).click();
  await expect(sizes.getByRole('radio', { name: 'Full' })).toHaveAttribute('aria-checked', 'true');
  const requests = spark.getByRole('switch', { name: 'Open requests by themselves' });
  await expect(requests).toHaveAttribute('aria-checked', 'true');
  await expect(spark).toContainText('It never takes the keyboard.');
  await requests.click();
  await expect(requests).toHaveAttribute('aria-checked', 'false');
  await expect(spark).toContainText('marks the blobs');
  const share = spark.getByRole('switch', { name: 'Hide in screen sharing' });
  await expect(share).toHaveAttribute('aria-checked', 'true');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'false');
  await expect(spark).toContainText('Spark Island shows in screen sharing');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'true');
  expect(
    await page.evaluate(() => (window as unknown as { desktopCalls: unknown[] }).desktopCalls),
  ).toEqual([
    ['enabled', true],
    ['sound', true],
    ['size', 'full'],
    ['autoExpand', false],
    ['hideInShare', false],
    ['hideInShare', true],
  ]);

  await fromIsland('sparks');
  await expect(page.getByRole('dialog', { name: 'Crew' })).toBeVisible();
});
