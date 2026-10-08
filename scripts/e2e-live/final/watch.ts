import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { DIR, sleep } from './lib.ts';

const label = process.argv[2]!;
const maxMinutes = Number(process.argv[3] ?? 30);
const state = JSON.parse(readFileSync(join(DIR, 'stack.json'), 'utf8')) as { web: string };
const shots = join(DIR, 'shots', label);
mkdirSync(shots, { recursive: true });
const chatFile = join(DIR, 'evidence', `${label}.chat.json`);
while (!existsSync(chatFile)) await sleep(500);
const chat = JSON.parse(readFileSync(chatFile, 'utf8')) as { conversationId: string };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'light'));
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(state.web);
const notes = join(shots, 'notes.log');
const note = (text: string) => appendFileSync(notes, `${new Date().toISOString()} ${text}\n`);

async function openChat(): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await page
      .locator('.rail-btn[data-view="chats"]')
      .click()
      .catch(() => undefined);
    const item = page.locator(`li[data-chat="${chat.conversationId}"] .row-open`).first();
    if ((await item.count()) > 0) {
      await item.click();
      return true;
    }
    await sleep(1_000);
  }
  return false;
}

const opened = await openChat();
note(`opened by id: ${opened}`);
let count = 0;
let lastKey = '';
const stop = Date.now() + maxMinutes * 60_000;
const doneFile = join(DIR, 'evidence', `${label}.json`);
let doneSeen = 0;
while (Date.now() < stop) {
  const status = (
    await page
      .locator('.cstatus')
      .innerText()
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .trim();
  const body = await page
    .locator('main')
    .innerText()
    .catch(() => '');
  const facts = [
    /Plan saved[^\n]*/.exec(body)?.[0] ?? '',
    /Queued[^\n]*/.exec(body)?.[0] ?? '',
    /Approve Plan/i.test(body) ? 'approve-plan' : '',
    /another piece|other piece/i.test(body) ? 'other-piece' : '',
  ].join('|');
  const key = `${status}#${facts}#${body.length >> 7}`;
  if (key !== lastKey) {
    lastKey = key;
    count += 1;
    const name = `${String(count).padStart(3, '0')}.png`;
    await page.screenshot({ path: join(shots, name) }).catch(() => undefined);
    note(`${name} status="${status}" facts="${facts}"`);
  }
  if (existsSync(doneFile)) {
    doneSeen += 1;
    if (doneSeen > 4) break;
  }
  await sleep(1_500);
}
await page
  .screenshot({ path: join(shots, 'final-full.png'), fullPage: true })
  .catch(() => undefined);
note(`page errors: ${JSON.stringify(errors).slice(0, 2000)}`);
await browser.close();
