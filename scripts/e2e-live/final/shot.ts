import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { DIR, sleep } from './lib.ts';

const [label = '', out = '', ...clicks] = process.argv.slice(2);
const state = JSON.parse(readFileSync(join(DIR, 'stack.json'), 'utf8')) as { web: string };
const chat = JSON.parse(readFileSync(join(DIR, 'evidence', `${label}.chat.json`), 'utf8')) as {
  conversationId: string;
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'light'));
const page = await context.newPage();
await page.goto(state.web);
await page.locator('.rail-btn[data-view="chats"]').click();
await page.locator(`li[data-chat="${chat.conversationId}"] .row-open`).first().click();
await sleep(2_500);
for (const click of clicks) {
  if (click === 'dump') {
    console.log((await page.locator('main').innerText()).slice(0, 6000));
    continue;
  }
  const [selector = '', nth = 'first'] = click.split('@@');
  const found = page.locator(selector);
  console.log(`${selector}: ${await found.count()} found`);
  if ((await found.count()) === 0) continue;
  const target =
    nth === 'last' ? found.last() : nth === 'first' ? found.first() : found.nth(Number(nth));
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  await target
    .click({ timeout: 5_000 })
    .catch((error: Error) => console.log(error.message.slice(0, 200)));
  await sleep(700);
}
await page.screenshot({ path: join(DIR, 'shots', out) });
await browser.close();
