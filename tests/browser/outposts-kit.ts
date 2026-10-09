import { randomUUID } from 'node:crypto';
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
export const thread = (page: Page) => page.getByRole('list', { name: 'Outpost thread' });
export const post = (page: Page, text: string) =>
  thread(page).locator('.op-post', { hasText: text });
export const stateOf = (item: Locator) => item.locator('.op-state');
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

export async function addChat(page: Page, dialog: Locator, title: string): Promise<Locator> {
  await dialog.getByRole('button', { name: 'Add a chat' }).click();
  await page
    .getByRole('menu', { name: 'Add a chat' })
    .getByRole('menuitemradio', { name: new RegExp(`^${title}`) })
    .click();
  return dialog.getByRole('textbox', { name: `Handle for ${title}` });
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
