import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { RemoteSession, RemoteSwitches } from '../../packages/contracts/src/remote.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb } from './database.ts';
import { openPhone, resetPhone, turnOn, WIDE } from './phone-support.ts';
import { animationsSettled } from './settle.ts';

const PHONE = { width: 390, height: 844 };
const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-phone';
const TOGGLE = 'Notify this device';

interface PushCalls {
  saved: unknown[];
  removed: unknown[];
}

test.beforeEach(async () => {
  await resetPhone();
});

async function fakeBrowserPush(page: Page, options: { supported: boolean; iphone?: boolean }) {
  await page.addInitScript(
    ({ supported, iphone, endpoint }) => {
      if (iphone) {
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
        });
      }
      if (!supported) {
        Reflect.deleteProperty(window, 'PushManager');
        return;
      }
      let current: object | null = null;
      const subscription = (key: ArrayBuffer) => ({
        endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({ endpoint, keys: { p256dh: 'BPhonePublicKey', auth: 'phoneAuth' } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      });
      const registration = {
        pushManager: {
          getSubscription: async () => current,
          subscribe: async (options: { applicationServerKey: Uint8Array }) => {
            current = subscription(options.applicationServerKey.slice().buffer);
            return current;
          },
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          register: async () => registration,
          ready: Promise.resolve(registration),
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
      });
      Object.defineProperty(window, 'PushManager', { value: function PushManager() {} });
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: async () => 'granted' },
      });
    },
    { ...options, endpoint: ENDPOINT },
  );
}

async function fakeMacPush(page: Page): Promise<PushCalls> {
  const calls: PushCalls = { saved: [], removed: [] };
  let endpoints: string[] = [];
  await page.route('**/api/remote/push', (route) =>
    route.fulfill({ json: { publicKey: KEY, endpoints } }),
  );
  await page.route('**/api/remote/push/subscription', async (route) => {
    const body = route.request().postDataJSON() as { endpoint: string };
    if (route.request().method() === 'PUT') {
      calls.saved.push(body);
      endpoints = [body.endpoint];
    } else {
      calls.removed.push(body);
      endpoints = [];
    }
    await route.fulfill({ json: { publicKey: KEY, endpoints } });
  });
  return calls;
}

async function asPairedPhone(page: Page, switches: Partial<RemoteSwitches>, view = 'phone') {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({
      response,
      json: {
        ...session,
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Test phone' },
        address: 'https://mac.tail.test',
        switches: { ...session.switches, ...switches },
      },
    });
  });
  await page.addInitScript((saved) => localStorage.setItem('spark-outpost.view', saved), view);
  await page.setViewportSize(PHONE);
}

const card = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test('a paired phone turns its notifications on and off', async ({ page }) => {
  await fakeBrowserPush(page, { supported: true });
  const calls = await fakeMacPush(page);
  await asPairedPhone(page, { notifications: true });
  await page.goto('/');

  const toggle = card(page).getByRole('switch', { name: TOGGLE });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toBeEnabled();
  await animationsSettled(page);
  const axe = await new AxeBuilder({ page })
    .include('section[aria-labelledby="ph-notify-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(card(page).getByRole('status')).toHaveText(
    'This device gets a notification when a chat needs you.',
  );
  expect(calls.saved).toEqual([
    { endpoint: ENDPOINT, keys: { p256dh: 'BPhonePublicKey', auth: 'phoneAuth' } },
  ]);
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(calls.removed).toEqual([{ endpoint: ENDPOINT }]);
});

test('with the switch off on the Mac the phone says so and cannot turn them on', async ({
  page,
}) => {
  await fakeBrowserPush(page, { supported: true });
  await fakeMacPush(page);
  await asPairedPhone(page, { notifications: false });
  await page.goto('/');
  await expect(card(page).getByRole('switch', { name: TOGGLE })).toBeDisabled();
  await expect(card(page).getByText('Notifications are turned off on your Mac.')).toBeVisible();
});

test('an iPhone browser outside the Home Screen is told how to get notifications', async ({
  page,
}) => {
  await fakeBrowserPush(page, { supported: false, iphone: true });
  await asPairedPhone(page, { notifications: true });
  await page.goto('/');
  await expect(card(page).getByText(/need iOS 16\.4 or later/)).toBeVisible();
  await expect(card(page).getByRole('switch')).toHaveCount(0);
});

test('a tapped notification opens its chat', async ({ page }) => {
  const id = randomUUID();
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO conversations (id, workspace_id, title, seen_at) VALUES ($1, $2, $3, now())`,
      [id, workspaceId, 'Fix the upload retry'],
    );
  } finally {
    await db.end();
  }
  await fakeBrowserPush(page, { supported: true });
  await asPairedPhone(page, { notifications: true }, 'home');
  await page.goto(`/?chat=${id}`);
  await expect(page.getByRole('heading', { name: 'Fix the upload retry' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('chat')).toBe(false);
});

async function refusedNotification(): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const deviceId = randomUUID();
    await db.query(
      `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, 'iPhone', $3)`,
      [deviceId, workspaceId, 'a'.repeat(64)],
    );
    await db.query(
      `INSERT INTO remote_audit (id, workspace_id, device_id, device_name, action, status, detail)
       VALUES ($1, $2, $3, 'iPhone', 'notification_sent', 403,
         '{"outcome":"failed","reason":"BadJwtToken"}')`,
      [randomUUID(), workspaceId, deviceId],
    );
  } finally {
    await db.end();
  }
}

test('the Mac sets the sender contact and shows why Apple refused a notification', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  const main = await openPhone(page);
  await turnOn(page);
  const switches = main.getByRole('region', { name: 'What paired devices can do' });
  const field = switches.getByRole('textbox', { name: 'Sender contact' });
  await expect(field).toHaveCount(0);

  await switches.getByRole('switch', { name: 'Notify when a chat needs you' }).click();
  await expect(field).toBeVisible();
  await expect(
    switches.getByText('In use: https://github.com/karki011/spark-outpost'),
  ).toBeVisible();

  await refusedNotification();
  await expect(switches.getByText(/did not accept the sender contact/)).toBeVisible({
    timeout: 10_000,
  });
  await animationsSettled(page);
  const axe = await new AxeBuilder({ page })
    .include('section[aria-labelledby="ph-switches-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  await field.fill('me@mac.local');
  await field.press('Enter');
  await expect(switches.getByRole('alert')).toHaveText(/Use an address on a public domain/);

  await field.fill('me@example.org');
  await switches.getByRole('button', { name: 'Save' }).click();
  await expect(switches.getByText('In use: me@example.org')).toBeVisible();
  await expect(switches.getByText(/did not accept the sender contact/)).toHaveCount(0);
  await expect(field).toBeFocused();
});
