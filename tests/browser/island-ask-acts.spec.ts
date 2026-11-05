import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const log = (page: Page) => island(page).locator('.isl-ask-log');

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(SHOTS, `island-ask-acts-${name}.png`),
    clip: { x: 300, y: 0, width: 680, height: 560 },
  });
}

async function openAsk(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+3');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toBeFocused();
  return ask;
}

async function stopRequested(runTitle: string) {
  const { rows } = await sql(
    `SELECT r.cancel_requested_at IS NOT NULL AS asked FROM runs r
     JOIN conversations c ON c.id = r.conversation_id WHERE c.title = $1`,
    [runTitle],
  );
  return rows[0]?.asked === true;
}

test('in Manual, Ask Spark shows a confirm card and acts only on Do it', async ({ page }) => {
  test.setTimeout(60_000);
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  const [build] = await seedChats([{ title: 'Build the site', run: { status: 'running' } }]);
  const ask = await openAsk(page);

  await ask.fill(`Stop it #build #spark spark_stop_chat {"chat":"${build}"}`);
  await page.keyboard.press('Enter');
  const card = log(page).getByRole('group', { name: 'Stop “Build the site”' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole('button', { name: 'Don’t' })).toBeVisible();
  expect(await stopRequested('Build the site')).toBe(false);
  await shot(page, 'card');

  await card.getByRole('button', { name: 'Do it' }).click();
  await expect(card.getByRole('status')).toHaveText('Stopped “Build the site”.', {
    timeout: 15_000,
  });
  expect(await stopRequested('Build the site')).toBe(true);
  await shot(page, 'done');

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /Spark assistant/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Spark assistant' })
    .getByRole('button', { name: 'View conversation' })
    .click();
  const thread = page.locator('.thread');
  await expect(thread).toContainText('Stop “Build the site”');
  await expect(thread).toContainText('Stopped “Build the site”.');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'island-ask-acts-thread.png') });
});

test('a waiting Ask Spark card shows on Home under Ask Spark needs you, and Do it there acts', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  const [build] = await seedChats([{ title: 'Build the site', run: { status: 'running' } }]);
  const ask = await openAsk(page);
  await ask.fill(`Stop it #build #spark spark_stop_chat {"chat":"${build}"}`);
  await page.keyboard.press('Enter');
  await expect(log(page).getByRole('group', { name: 'Stop “Build the site”' })).toBeVisible({
    timeout: 20_000,
  });

  await page.keyboard.press('Meta+1');
  const needs = island(page).getByRole('region', { name: 'Ask Spark needs you' });
  const card = needs.getByRole('group', { name: 'Stop “Build the site”' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(needs.getByText('Ask Spark', { exact: true })).toBeVisible();
  await shot(page, 'needs-you');
  await card.getByRole('button', { name: 'Do it' }).click();
  await expect.poll(() => stopRequested('Build the site'), { timeout: 15_000 }).toBe(true);
});

test('Don’t leaves the chat running, and Act does it at once', async ({ page }) => {
  test.setTimeout(60_000);
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  const [build] = await seedChats([{ title: 'Build the site', run: { status: 'running' } }]);
  const ask = await openAsk(page);

  await ask.fill(`Stop it #build #spark spark_stop_chat {"chat":"${build}"}`);
  await page.keyboard.press('Enter');
  const card = log(page).getByRole('group', { name: 'Stop “Build the site”' });
  await card.getByRole('button', { name: 'Don’t' }).click({ timeout: 20_000 });
  await expect(card.getByRole('status')).toHaveText('Not done.');
  expect(await stopRequested('Build the site')).toBe(false);

  await sql(`UPDATE profiles SET assistant_acts = 'act'`);
  await ask.fill(`Stop it now #build #spark spark_stop_chat {"chat":"${build}"}`);
  await page.keyboard.press('Enter');
  await expect(log(page).getByRole('status').last()).toHaveText('Stopped “Build the site”.', {
    timeout: 20_000,
  });
  expect(await stopRequested('Build the site')).toBe(true);
});

test('Settings sets when Ask Spark acts', async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'], catalog: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: /Spark assistant/ })
    .click();
  const section = page.getByRole('dialog', { name: 'Spark assistant' });
  const picker = section.getByRole('button', { name: 'When Ask Spark acts' });
  await expect(picker).toHaveText('Manual (recommended)');
  await expect(
    section.getByText('Each action shows a card in the Ask panel with Do it and Don’t.'),
  ).toBeVisible();
  await picker.click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/spark-assistant/settings') && response.ok(),
  );
  await page
    .getByRole('menu', { name: 'When Ask Spark acts' })
    .getByRole('menuitemradio', { name: /^Act/ })
    .click();
  await saved;
  const { rows } = await sql('SELECT assistant_acts AS acts FROM profiles');
  expect(rows[0]?.acts).toBe('act');
});
