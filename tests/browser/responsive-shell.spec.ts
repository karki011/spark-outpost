import { expect, test, type Page } from '@playwright/test';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';
import { seedAnalytics } from './analytics-seed.ts';
import { resetTestDatabase } from './database.ts';
import {
  DESKTOP,
  expectInsideViewport,
  expectNoSidewaysScroll,
  isPhone,
  mainNav,
  navButton,
  openSettings,
  openTouch,
  PHONE,
  PHONE_WIDE,
  shot,
  sizeName,
  smallTapTargets,
  smallTextInputs,
  TABLET,
  TOUCH_SIZES,
  widerThanItsBox,
} from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';
import { closeChatMenu, headerPaneItem, openChatMenu } from './header-menu.ts';

test.describe.configure({ timeout: 120_000 });

const PRIMARY = ['Home', 'Chats', 'Analytics', 'Tickets', 'Docs'];
const UNDER_MORE = ['Remote control'];
const SECTIONS = [
  'Profile & personality',
  'Spark assistant',
  'Appearance',
  'AI providers',
  'Models',
  'Crew',
  'Usage',
  'Projects',
  'Chats & autonomy',
  'Pull requests',
  'Connectors',
  'MCP servers',
  'Notifications',
  'Help',
  'Reset',
];

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  await seedChats([
    { title: 'Add CSV export to invoices', run: { status: 'succeeded' } },
    { title: 'Fix the login redirect loop', run: { status: 'succeeded' }, minutesAgo: 90 },
  ]);
  const spark = await page.request.post('/api/teammates', {
    data: { name: 'Pip', role: 'Reviewer' },
  });
  expect(spark.status()).toBe(201);
});

async function asRemote(
  page: Page,
  switches: Partial<RemoteSession['switches']> = {},
): Promise<void> {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({
      response,
      json: {
        ...session,
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Maya’s iPhone' },
        address: 'https://mac.tail.test',
        switches: { ...session.switches, ...switches },
      } satisfies RemoteSession,
    });
  });
}

for (const size of TOUCH_SIZES) {
  const phone = isPhone(size);

  test(`every destination is reachable at ${sizeName(size)}`, async ({ browser }) => {
    const page = await openTouch(browser, size, 'home');
    const nav = await mainNav(page).boundingBox();
    expect(nav).not.toBeNull();
    if (phone) expect(nav!.y + nav!.height).toBeGreaterThan(size.height - 2);
    else expect(nav!.width).toBeLessThan(100);

    expect(await widerThanItsBox(page.locator('.home'))).toEqual([]);
    if (phone) await expect(navButton(page, 'Map')).toHaveCount(0);
    for (const name of phone ? PRIMARY : [...PRIMARY, 'Map']) {
      await expectInsideViewport(page, navButton(page, name));
      await navButton(page, name).click();
      await expect(navButton(page, name)).toHaveAttribute('aria-current', 'page');
      await shot(page, name.toLowerCase());
    }
    for (const name of UNDER_MORE) {
      if (phone) {
        await navButton(page, 'More').click();
        await expectInsideViewport(page, page.getByRole('group', { name: 'More destinations' }));
      }
      await expectInsideViewport(page, navButton(page, name));
      await navButton(page, name).click();
      await expect(page.getByRole('main', { name })).toBeVisible();
      if (phone)
        await expect(navButton(page, 'More')).toHaveAccessibleName(`More, showing ${name}`);
    }
    await expectNoSidewaysScroll(page);
    await shot(page, 'phone-page');

    const dialog = await openSettings(page, phone);
    await expectInsideViewport(page, dialog);
    await page.close();
  });

  test(`every Settings section is reachable at ${sizeName(size)}`, async ({ browser }) => {
    const page = await openTouch(browser, size, 'home');
    await openSettings(page, phone);
    const tabs = page.getByRole('tablist', { name: 'Settings sections' });
    for (const name of SECTIONS) {
      const tab = tabs.getByRole('tab', { name: new RegExp(`^${name}( \\d+)?$`) });
      await tab.scrollIntoViewIfNeeded();
      await expectInsideViewport(page, tab);
      await tab.click();
      await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
    }
    if (phone) {
      const strip = await tabs.boundingBox();
      expect(strip!.height).toBeLessThan(80);
    }
    await tabs.getByRole('tab', { name: 'Profile & personality' }).click();
    await expect(page.locator('.set-body .seg').first()).toBeVisible();
    expect(await smallTextInputs(page)).toEqual([]);
    const body = page.locator('.set-body');
    expect(await body.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      0,
    );
    await shot(page, 'settings-spark');
    await page.close();
  });

  test(`menus stay inside the screen at ${sizeName(size)}`, async ({ browser }) => {
    await seedAnalytics(14);
    const page = await openTouch(browser, size, 'home');
    await page.getByRole('button', { name: /^Talk to/ }).click();
    await expectInsideViewport(page, page.getByRole('menu', { name: 'Talk to' }));
    await shot(page, 'home-talk-to-menu');
    await page.keyboard.press('Escape');

    await navButton(page, 'Analytics').click();
    await page.getByText('Custom', { exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a custom date range' });
    await expectInsideViewport(page, calendar);
    await expectInsideViewport(page, calendar.getByRole('button', { name: 'Cancel' }));
    await shot(page, 'analytics-custom-range');
    await page.keyboard.press('Escape');

    await navButton(page, 'Chats').click();
    if (phone) {
      await page.getByRole('button', { name: 'Chat actions' }).click();
      const menu = page.locator('.head-menu-pop');
      await expectInsideViewport(page, menu);
      await expect(menu.getByRole('menuitem', { name: 'Theme' })).toBeVisible();
      await shot(page, 'chat-actions-menu');
    } else {
      await page.getByRole('button', { name: 'Theme' }).click();
      await expectInsideViewport(page, page.getByRole('menu', { name: 'Theme' }));
      await shot(page, 'chat-theme-menu');
    }
    await page.close();
  });
}

test('shared controls are finger-sized and inputs do not zoom on touch', async ({ browser }) => {
  for (const size of [PHONE, TABLET]) {
    const page = await openTouch(browser, size, 'chats');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    expect(await smallTapTargets(page)).toEqual([]);
    expect(await smallTextInputs(page)).toEqual([]);
    if (isPhone(size)) await page.getByRole('button', { name: /^(Open|Show) sidebar/ }).click();
    await expect(page.getByRole('navigation', { name: 'Chats' })).toBeVisible();
    expect(await smallTapTargets(page)).toEqual([]);
    expect(await smallTextInputs(page)).toEqual([]);
    await page.close();
  }
});

test('a paired phone hides what only works on the Mac', async ({ browser }) => {
  const page = await openTouch(browser, PHONE, 'chats');
  await openChatMenu(page);
  await expect(headerPaneItem(page, 'Terminal')).toBeVisible();
  await page.close();

  const phone = await openTouch(browser, PHONE, 'chats', (opened) =>
    asRemote(opened, { reset: false }),
  );
  await expect(phone.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await openChatMenu(phone);
  await expect(headerPaneItem(phone, 'Terminal')).toHaveCount(0);
  await expect(headerPaneItem(phone, 'Browser')).toHaveCount(0);
  await closeChatMenu(phone);
  await expect(phone.getByRole('button', { name: /Terminal|Browser/ })).toHaveCount(0);

  await openSettings(phone, true);
  const tabs = phone.getByRole('tablist', { name: 'Settings sections' });
  await expect(tabs.getByRole('tab', { name: 'Updates' })).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Help' }).click();
  await expect(phone.getByRole('heading', { level: 3, name: 'Help' })).toBeVisible();
  await expect(phone.getByRole('region', { name: 'Full Disk Access' })).toHaveCount(0);
  await expect(phone.getByRole('button', { name: 'Export diagnostics' })).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Reset' }).click();
  await expect(phone.getByRole('note')).toHaveText('Turned off for remote control on your Mac');
  await shot(phone, 'remote-settings-reset-off');
  await phone.keyboard.press('Escape');

  await navButton(phone, 'More').click();
  await navButton(phone, 'Remote control').click();
  await expect(phone.getByRole('heading', { name: 'Connected to your Mac' })).toBeVisible();
  await expect(phone.getByText('Maya’s iPhone')).toBeVisible();
  await expect(phone.getByText('https://mac.tail.test')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Pair a device' })).toHaveCount(0);
  await expect(phone.getByRole('switch')).toHaveAccessibleName('Notify this device');
  await expect(phone.getByText(/Change these on your Mac/)).toBeVisible();
  await shot(phone, 'remote-phone-page');
  await phone.close();
});

test('phone landscape with a mouse-sized window keeps the desktop shell', async ({ page }) => {
  await page.setViewportSize(PHONE_WIDE);
  await page.goto('/');
  const nav = await mainNav(page).boundingBox();
  expect(nav!.width).toBeLessThan(100);
  await expect(navButton(page, 'More')).toHaveCount(0);
});

test('the desktop rail keeps all nine entries', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await expect(mainNav(page).locator('.rail-btn')).toHaveText([
    /^Home/,
    /^Chats/,
    /^Analytics/,
    /^Tickets/,
    /^Map/,
    /^Docs/,
    /^Pause$/,
    /^Remote$/,
    /^Settings/,
  ]);
  await shot(page, 'rail');
});

test('the web app manifest and phone icons are served', async ({ page }) => {
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as {
    name: string;
    display: string;
    icons: { src: string }[];
  };
  expect(body.name).toBe('Spark Outpost');
  expect(body.display).toBe('standalone');
  for (const icon of [...body.icons.map((entry) => entry.src), '/apple-touch-icon.png']) {
    const response = await page.request.get(icon);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover.*interactive-widget=resizes-content/,
  );
});
