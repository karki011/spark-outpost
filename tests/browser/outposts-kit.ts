import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type Request } from '@playwright/test';
import type { RemoteSession } from '../../packages/contracts/src/remote.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';

export const NAME = 'Orders launch';
export const TURN_TIMEOUT = 45_000;
export const LONG_ASK = Array.from({ length: 220 }, (_, index) => `word${index}`).join(' ');
export const POSTS_URL = /\/api\/outposts\/[^/]+\/posts$/;
export const CANCEL_URL = /\/api\/outposts\/[^/]+\/posts\/[^/]+\/cancel$/;
export const MEMBER_URL = /\/api\/outposts\/[^/]+\/members\/[^/]+$/;

interface Member {
  conversationId: string;
  handle: string;
}

export const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
export const outpostsSection = (page: Page) =>
  sidebar(page).getByRole('region', { name: 'Outposts' });
export const outpostRow = (page: Page, name: string) =>
  outpostsSection(page).getByRole('button', { name: new RegExp(`^${name}`) });
export const outpostPage = (page: Page, name: string) =>
  page.getByRole('main', { name: `Outpost ${name}` });
export const box = (page: Page) => page.getByRole('combobox', { name: 'Message the outpost' });
export const sendButton = (page: Page) => page.locator('.op-send');
export const asksLine = (page: Page) =>
  page.getByRole('group', { name: 'Chats this message asks' });
export const thread = (page: Page) => page.getByRole('list', { name: 'Outpost thread' });
export const post = (page: Page, text: string) =>
  thread(page).locator('.op-post', { hasText: text });
export const stateOf = (item: Locator) => item.locator('.op-pill');
export const cardOf = (item: Locator) => item.locator('.op-card');
export const threadPane = (page: Page, handle: string) =>
  page.getByRole('complementary', { name: `Thread with @${handle}` });

export async function cancelRequest(item: Locator, handle: string): Promise<void> {
  await item
    .getByRole('button', { name: new RegExp(`^(Cancel|Stop) the request to @${handle}…$`) })
    .click();
  await item.getByRole('button', { name: /^(Cancel|Stop)$/ }).click();
}

export async function openThread(item: Locator, handle: string): Promise<void> {
  await item.getByRole('button', { name: `Open the thread with @${handle}` }).click();
}

export async function openSettings(page: Page, name: string): Promise<Locator> {
  await outpostPage(page, name).getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Outpost Settings…' }).click();
  return sheet(page, 'Edit outpost');
}
export const strip = (page: Page) => page.getByRole('toolbar', { name: 'Chats in this outpost' });
export const chip = (page: Page, handle: string) =>
  strip(page).getByRole('button', { name: new RegExp(`^@${handle}\\b`) });
export const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });
export const toast = (page: Page, text: string) =>
  sidebar(page).getByRole('status').filter({ hasText: text });

export async function seeded(
  page: Page,
  handles: ('fe' | 'api')[] = ['fe', 'api'],
): Promise<string> {
  const [frontend, api] = await seedChats([
    { title: 'Frontend' },
    { title: 'Orders API' },
    { title: 'Docs site' },
  ]);
  if (!frontend || !api) throw new Error('The chats were not seeded.');
  await openChats(page);
  const chats = { fe: frontend, api };
  const members: Member[] = handles.map((handle) => ({ conversationId: chats[handle], handle }));
  const id = randomUUID();
  const created = await page.request.post('/api/outposts', { data: { id, name: NAME, members } });
  expect(created.ok()).toBe(true);
  await openChats(page);
  return id;
}

export async function postNotes(page: Page, outpostId: string, count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    const posted = await page.request.post(`/api/outposts/${outpostId}/posts`, {
      data: { id: randomUUID(), text: `Filler ${index}\nwith\nseveral\nlines` },
    });
    expect(posted.ok()).toBe(true);
  }
}

export async function openOutpost(page: Page, name = NAME): Promise<Locator> {
  await outpostRow(page, name).click();
  const main = outpostPage(page, name);
  await expect(main).toBeVisible();
  return main;
}

export async function say(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await box(page).press('Enter');
}

export const NEW_OUTPOST = 'New outpost';
export const stepNow = (dialog: Locator) =>
  dialog.getByRole('list', { name: 'Steps' }).locator('[aria-current="step"]');
export const proceed = (dialog: Locator) => dialog.getByRole('button', { name: /^Continue/ });
export const startButton = (dialog: Locator) =>
  dialog.getByRole('button', { name: /^Start outpost/ });

export async function newOutpost(page: Page, name?: string): Promise<Locator> {
  await outpostsSection(page).getByRole('button', { name: NEW_OUTPOST }).click();
  const dialog = sheet(page, NEW_OUTPOST);
  const field = dialog.getByRole('textbox', { name: /^Name/ });
  await expect(field).toBeFocused();
  if (name === undefined) return dialog;
  await field.fill(name);
  await field.press('Enter');
  await expect(stepNow(dialog)).toContainText('Chats');
  return dialog;
}

export async function pick(page: Page, dialog: Locator, field: string, choice: string) {
  await dialog.getByRole('button', { name: field, exact: true }).click();
  await page
    .getByRole('menu', { name: field })
    .getByRole('menuitemradio', { name: new RegExp(`^${choice}`) })
    .click();
}

export function requestsTo(page: Page, url: RegExp, method: string): Request[] {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === method && url.test(request.url())) seen.push(request);
  });
  return seen;
}

export async function asPairedPhone(page: Page): Promise<void> {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({ response, json: { ...session, remote: true } });
  });
}

const SHOTS = process.env.SPARK_REVIEW_SHOTS;
const THEMES = [
  ['light', 'light'],
  ['dark', 'graphite'],
] as const;

export async function inBothThemes(
  page: Page,
  name: string,
  check: () => Promise<void>,
): Promise<void> {
  const root = page.locator('html');
  const before = await root.getAttribute('data-skin');
  for (const [scheme, skin] of THEMES) {
    await root.evaluate((html, value) => (html.dataset.skin = value), skin);
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}-${name}-${scheme}.png` });
    await check();
    const results = await new AxeBuilder({ page })
      .include('.main.op')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  }
  await root.evaluate((html, value) => {
    if (value === null) delete html.dataset.skin;
    else html.dataset.skin = value;
  }, before);
}

export async function expectTopmost(menu: Locator): Promise<void> {
  await expect(menu).toBeVisible();
  const covered = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inset = 10;
    const corners = [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
    ];
    const inWindow =
      box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    const hidden = corners.filter(([x, y]) => !element.contains(document.elementFromPoint(x!, y!)));
    return { inWindow, hidden: hidden.length };
  });
  expect(covered).toEqual({ inWindow: true, hidden: 0 });
}
