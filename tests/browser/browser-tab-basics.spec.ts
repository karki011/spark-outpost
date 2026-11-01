import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBrowserView, pushView, viewCommands } from './browser-view-support.ts';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

interface Sent {
  command: Record<string, unknown>;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function openPane(page: Page, tabs: Record<string, unknown>[]): Promise<Locator> {
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  const started = (await calls(page, 'start')) as { chatId: string }[];
  await page.evaluate(
    ([chat, list]) =>
      (window as unknown as { browserPush: (id: string, tabs: unknown) => void }).browserPush(
        chat as string,
        list,
      ),
    [started[0]!.chatId, tabs] as const,
  );
  return pane;
}

async function lastSent(page: Page): Promise<Record<string, unknown> | undefined> {
  return ((await calls(page, 'command')) as Sent[]).at(-1)?.command;
}

const THREE = [
  { title: 'One', url: 'https://one.example.com/', active: true },
  { title: 'Two', url: 'https://two.example.com/' },
  { title: 'Three', url: 'https://three.example.com/' },
];

test('a tab with sound shows it as a word, and the button mutes it', async ({ page }) => {
  const pane = await openPane(page, [
    { title: 'Radio', url: 'https://radio.example.com/', active: true, audible: true },
    { title: 'Quiet', url: 'https://quiet.example.com/' },
    { title: 'Silenced', url: 'https://silenced.example.com/', muted: true },
  ]);
  const mute = pane.getByRole('button', { name: 'Mute Radio' });
  await expect(mute).toHaveText('Playing');
  await expect(pane.getByRole('button', { name: 'Mute Quiet' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Unmute Silenced' })).toHaveText('Muted');
  const box = await mute.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(28);
  await mute.click();
  expect(await lastSent(page)).toEqual({ command: 'mute', tabId: 't1', muted: true });
});

test('zoom keys run in the pane, and the badge shows the factor and resets it', async ({
  page,
}) => {
  const pane = await openPane(page, [{ ...THREE[0], zoom: 1.25 }]);
  await pane.getByLabel('Address').focus();
  for (const [keys, step] of [
    ['ControlOrMeta+Equal', 'in'],
    ['ControlOrMeta+Minus', 'out'],
    ['ControlOrMeta+Digit0', 'reset'],
  ] as const) {
    await page.keyboard.press(keys);
    await expect.poll(() => lastSent(page)).toEqual({ command: 'zoom', tabId: 't1', step });
  }
  const badge = pane.getByRole('button', { name: 'Page zoom 125%. Reset to 100%' });
  await expect(badge).toHaveText('125%');
  await badge.click();
  expect(await lastSent(page)).toEqual({ command: 'zoom', tabId: 't1', step: 'reset' });
});

test('page tools offer zoom, mute, picture in picture and print by keyboard', async ({ page }) => {
  const pane = await openPane(page, THREE.slice(0, 1));
  const tools = pane.getByRole('button', { name: 'Page tools' });
  await tools.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Page tools' });
  await expect(menu.getByRole('menuitem', { name: 'Zoom In' })).toBeFocused();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Zoom In/,
    /Zoom Out/,
    /Actual Size/,
    'Mute Tab',
    'Picture in Picture',
    /Print…/,
  ]);
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Print…' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tools).toBeFocused();
  expect(await lastSent(page)).toEqual({ command: 'print', tabId: 't1' });

  await tools.click();
  await menu.getByRole('menuitem', { name: 'Picture in Picture' }).click();
  expect(await lastSent(page)).toEqual({ command: 'pip', tabId: 't1' });
  await page.keyboard.press('ControlOrMeta+KeyP');
  await expect(tools).toBeFocused();
});

test('tabs reorder with Shift and arrows, keeping the focus, and by dragging', async ({ page }) => {
  const pane = await openPane(page, THREE);
  const first = pane.getByRole('tab', { name: 'One', exact: true });
  await first.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await lastSent(page)).toBeUndefined();
  await page.keyboard.press('Shift+ArrowRight');
  expect(await lastSent(page)).toEqual({ command: 'move', tabId: 't1', before: 't3' });
  await expect(first).toBeFocused();
  await expect(pane.getByRole('status').filter({ hasText: 'Moved One' })).toHaveText(
    'Moved One to position 2 of 3',
  );

  await first.hover();
  const third = await pane.getByRole('tab', { name: 'Three', exact: true }).boundingBox();
  const start = (await first.boundingBox())!;
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(third!.x + third!.width - 4, third!.y + 10, { steps: 6 });
  await expect(page.locator('.tab-drop-after')).toHaveCount(1);
  const before = ((await calls(page, 'command')) as Sent[]).length;
  await page.mouse.up();
  expect(await lastSent(page)).toEqual({ command: 'move', tabId: 't1', before: null });
  expect(((await calls(page, 'command')) as Sent[]).length).toBe(before + 1);
});

test('a drag cancelled with Esc moves nothing and selects nothing', async ({ page }) => {
  const pane = await openPane(page, THREE);
  await pane.getByRole('tab', { name: 'One', exact: true }).hover();
  const first = (await pane.getByRole('tab', { name: 'One', exact: true }).boundingBox())!;
  const third = (await pane.getByRole('tab', { name: 'Three', exact: true }).boundingBox())!;
  const before = ((await calls(page, 'command')) as Sent[]).length;
  await page.mouse.move(first.x + 10, first.y + 10);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width - 4, third.y + 10, { steps: 6 });
  await expect(page.locator('.tab-drop-after')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tab-drop-after')).toHaveCount(0);
  await page.mouse.up();
  expect(((await calls(page, 'command')) as Sent[]).length).toBe(before);
});

test('the Browser view reorders its list by key and drag, with the mute word', async ({ page }) => {
  const side = await openBrowserView(page);
  await pushView(page, [
    { title: 'One', url: 'https://one.example.com/', active: true, audible: true },
    { title: 'Two', url: 'https://two.example.com/' },
    { title: 'Three', url: 'https://three.example.com/' },
  ]);
  await expect(side.getByRole('button', { name: 'Mute One' })).toHaveText('Playing');
  const first = side.getByRole('button', { name: 'One', exact: true });
  await first.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'move', tabId: 'v1', before: 'v3' },
    });
  await expect(first).toBeFocused();
  const box = (await first.boundingBox())!;
  const last = (await side.getByRole('button', { name: 'Three', exact: true }).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(last.x + 20, last.y + last.height - 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toEqual({
      profile: 'personal',
      command: { command: 'move', tabId: 'v1', before: null },
    });
  await page.keyboard.press('ControlOrMeta+Equal');
  await expect
    .poll(async () => (await viewCommands(page)).at(-1))
    .toMatchObject({
      command: { command: 'zoom', tabId: 'v1', step: 'in' },
    });
});
