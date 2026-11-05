import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = 'test-results/sparks';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const home = (page: Page) =>
  page.getByRole('main', { name: /^Good (morning|afternoon|evening)|^Working late/ });
const sparks = (page: Page) => home(page).getByRole('region', { name: 'Your Sparks' });
const sheet = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(home(page)).toBeVisible();
}

async function addSpark(page: Page, data: Record<string, unknown>): Promise<string> {
  const response = await page.request.post('/api/teammates', { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function holdToDelete(page: Page, name: string) {
  const hold = page.getByRole('button', { name: `Hold to delete ${name}` });
  await hold.scrollIntoViewIfNeeded();
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_700);
  await page.mouse.up();
}

test('an empty roster offers starter Sparks and creates nothing until a click', async ({
  page,
}) => {
  await openHome(page);
  const starters = sparks(page).getByRole('list', { name: 'Suggested Sparks' });
  await expect(starters.getByRole('listitem')).toHaveCount(3);
  await expect(starters).toContainText('Pip · Code reviewer');
  await expect(starters).toContainText('Wren · Docs writer');
  await expect(starters).toContainText('Bolt · Bug fixer');
  expect(
    ((await (await page.request.get('/api/teammates')).json()) as { teammates: [] }).teammates,
  ).toHaveLength(0);
  await page.screenshot({ path: `${SHOTS}/starter-suggestions.png` });

  await starters.getByRole('button', { name: 'Dismiss Wren' }).click();
  await expect(starters.getByRole('listitem')).toHaveCount(2);
  await starters.getByRole('button', { name: 'Add Pip, Code reviewer' }).click();

  const card = sparks(page).getByRole('button', { name: /^Open Pip's chat/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Code reviewer');
  await expect(card).toContainText('No chats yet');
  await expect(sparks(page).getByRole('list', { name: 'Suggested Sparks' })).toHaveCount(0);
});

test('create a Spark, open its home thread and see its face in the chat', async ({ page }) => {
  await addSpark(page, {
    name: 'Pip',
    role: 'Code reviewer',
    face: { shape: 'round', color: 'sky' },
  });
  await openHome(page);
  await sparks(page).getByRole('button', { name: 'New Spark' }).click();

  const form = sheet(page, 'New Spark');
  await expect(form).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await form.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await form.getByRole('textbox', { name: 'Role' }).fill('Release manager');
  await form.getByRole('button', { name: 'Change look' }).click();
  await form.getByRole('radio', { name: 'Cloud' }).click();
  await form.getByRole('radio', { name: 'Plum' }).click();
  await form.getByRole('button', { name: 'Provider' }).click();
  await page.getByRole('menuitemradio', { name: 'Claude' }).click();
  await form.getByRole('button', { name: 'Spark autonomy' }).click();
  await page.getByRole('menuitemradio', { name: /Full auto → PR/ }).click();
  await form
    .getByRole('textbox', { name: 'Standing instructions' })
    .fill('Check the changelog and version before every release.');
  await expect(form).toContainText('53 / 2000');
  await page.screenshot({ path: `${SHOTS}/create-sheet.png` });
  await form.getByRole('button', { name: 'Create Spark' }).click();
  await expect(form).toHaveCount(0);

  const card = sparks(page).getByRole('button', { name: /^Open Ada's chat/ });
  await expect(card).toContainText('Release manager');
  await page.screenshot({ path: `${SHOTS}/home-roster.png` });

  await card.click();
  const header = page.locator('.head');
  await expect(header.locator('.tm-head')).toContainText('Release manager');
  await expect(header.getByRole('heading', { name: 'Ada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talking to Ada' })).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('What is left before the release?');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'Turn' }).first()).toContainText('What is left');
  await page.screenshot({ path: `${SHOTS}/chat-header.png` });

  const row = sidebar(page).getByRole('button', { name: 'Ada with Ada' });
  await expect(row).toBeVisible();
  await expect(sidebar(page).locator('.rface')).toHaveCount(1);
  await expect(sidebar(page).locator('.row:has(.rface) .st > *')).toHaveCount(1);
  await expect(sidebar(page).locator('.row:has(.rface) .chat-face')).toHaveCount(0);
  await sidebar(page)
    .getByRole('group', { name: 'Filter chats by Spark' })
    .getByRole('button', { name: 'Ada' })
    .click();
  await expect(page.getByRole('searchbox', { name: 'Search chats' })).toHaveValue('with:ada');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await sparks(page)
    .getByRole('button', { name: /^Open Ada's chat/ })
    .click();
  await expect(page.getByRole('region', { name: 'Turn' }).first()).toContainText('What is left');
});

test('Talk to on Home starts the next chat with a Spark, then goes back to plain', async ({
  page,
}) => {
  await addSpark(page, { name: 'Bolt', role: 'Bug fixer', level: 'full-auto' });
  await openHome(page);
  const compose = home(page).getByRole('region', { name: 'Start a new chat' });
  const bar = compose.locator('.ctxbar');
  await expect(bar.getByRole('button', { name: 'Choose project' })).toBeVisible();
  const talk = bar.getByRole('button', { name: 'Talk to…' });
  await talk.click();
  const menu = compose.getByRole('menu', { name: 'Talk to' });
  await expect(menu.getByRole('menuitemradio', { name: /No Spark/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const [chipBox, menuBox] = [await talk.boundingBox(), await menu.boundingBox()];
  expect(Math.abs(menuBox!.x - chipBox!.x)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(talk).toBeFocused();
  await talk.click();
  await page.getByRole('menuitemradio', { name: /Bolt/ }).click();
  await expect(compose.getByRole('button', { name: 'Talking to Bolt' })).toBeVisible();

  const input = compose.getByRole('textbox', { name: 'Message' });
  await input.fill('The save button crashes');
  await input.press('Enter');
  await expect(compose.getByRole('button', { name: 'Talk to…' })).toBeVisible();

  const chats = (await (await page.request.get('/api/conversations')).json()) as {
    title: string;
    teammate: { name: string } | null;
  }[];
  expect(chats.map((chat) => [chat.title, chat.teammate?.name ?? null])).toEqual([
    ['The save button crashes', 'Bolt'],
  ]);
});

test('edit a Spark, then hold to delete with Undo; its chats stay @packaged', async ({ page }) => {
  test.setTimeout(60_000);
  const id = await addSpark(page, { name: 'Wren', role: 'Docs writer' });
  const home = await page.request.post(`/api/teammates/${id}/home`, { data: {} });
  const { conversationId } = (await home.json()) as { conversationId: string };
  await openHome(page);

  await sparks(page).getByRole('button', { name: 'Edit Wren' }).click();
  const form = sheet(page, 'Edit Wren');
  await form.getByRole('textbox', { name: 'Role' }).fill('Docs and guides');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(sparks(page)).toContainText('Docs and guides');

  await sparks(page).getByRole('button', { name: 'Edit Wren' }).click();
  await holdToDelete(page, 'Wren');
  const grace = page.locator('.grace');
  await expect(grace).toContainText('Deleting Wren');
  await expect(sparks(page).getByRole('button', { name: /^Open Wren's chat/ })).toHaveCount(0);
  await grace.getByRole('button', { name: 'Undo' }).click();
  await expect(sparks(page).getByRole('button', { name: /^Open Wren's chat/ })).toBeVisible();

  await sparks(page).getByRole('button', { name: 'Edit Wren' }).click();
  await holdToDelete(page, 'Wren');
  await expect(grace).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/teammates')).json()) as { teammates: [] }).teammates
          .length,
    )
    .toBe(0);
  const chat = await page.request.get(`/api/conversations/${conversationId}`);
  expect(chat.status()).toBe(200);
});

test('Settings lists Sparks and opens the same sheet', async ({ page }) => {
  await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Crew' })
    .click();
  const section = page.getByRole('dialog', { name: 'Crew' });
  await expect(section.getByRole('list', { name: 'Your Sparks' })).toContainText('Pip');
  await section.getByRole('button', { name: 'Edit Pip' }).click();
  await expect(sheet(page, 'Edit Pip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page, 'Edit Pip')).toHaveCount(0);
  await expect(section).toBeVisible();
});

test('Settings deletes a Spark with hold to delete and Undo @packaged', async ({ page }) => {
  test.setTimeout(60_000);
  const id = await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await addSpark(page, { name: 'Bolt', role: 'Bug fixer' });
  const opened = await page.request.post(`/api/teammates/${id}/home`, { data: {} });
  const { conversationId } = (await opened.json()) as { conversationId: string };
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Crew' })
    .click();
  const section = page.getByRole('dialog', { name: 'Crew' });
  const list = section.getByRole('list', { name: 'Your Sparks' });

  await list.getByRole('button', { name: 'Delete Pip' }).click();
  const hold = sheet(page, 'Edit Pip').getByRole('button', { name: 'Hold to delete Pip' });
  await expect(hold).toBeInViewport();
  await expect(hold).toBeFocused();
  await page.keyboard.down('Space');
  await page.waitForTimeout(1_700);
  await page.keyboard.up('Space');
  const grace = page.locator('.grace');
  await expect(grace).toContainText('Deleting Pip');
  await expect(list).not.toContainText('Pip');
  await grace.getByRole('button', { name: 'Undo' }).click();
  await expect(list).toContainText('Pip');

  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && response.url().endsWith(`/api/teammates/${id}`),
    { timeout: 20_000 },
  );
  await list.getByRole('button', { name: 'Delete Pip' }).click();
  await holdToDelete(page, 'Pip');
  await expect(grace).toContainText('Deleting Pip');
  expect((await removed).status()).toBe(204);
  await expect(grace).toHaveCount(0);
  await expect(list).not.toContainText('Pip');
  await expect(list).toContainText('Bolt');
  await expect(section).toBeVisible();
  const chat = await page.request.get(`/api/conversations/${conversationId}`);
  expect(chat.status()).toBe(200);
});

test('a Spark that cannot be deleted comes back with the reason', async ({ page }) => {
  const id = await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await openChats(page);
  await page.route(`**/api/teammates/${id}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, json: { error: 'The database is busy.' } })
      : route.continue(),
  );
  await page.clock.install();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Crew' })
    .click();
  const list = page
    .getByRole('dialog', { name: 'Crew' })
    .getByRole('list', { name: 'Your Sparks' });
  await list.getByRole('button', { name: 'Delete Pip' }).click();
  const hold = page.getByRole('button', { name: 'Hold to delete Pip' });
  await hold.hover();
  await page.mouse.down();
  await page.clock.runFor(1_600);
  await page.mouse.up();
  await expect(page.locator('.grace')).toContainText('Deleting Pip');
  await page.clock.runFor(10_500);
  await expect(page.getByRole('alert')).toContainText('Pip wasn’t deleted. The database is busy.');
  await expect(list).toContainText('Pip');
});

test('the roster and the sheet pass axe and fit a phone', async ({ page }) => {
  await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await addSpark(page, { name: 'Bolt', role: 'Bug fixer' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await expect(sparks(page).getByRole('button', { name: /^Open Pip's chat/ })).toBeVisible();
  await animationsSettled(page);
  const axe = () =>
    new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).include('.tm-section');
  expect((await axe().analyze()).violations).toEqual([]);

  await sparks(page).getByRole('button', { name: 'New Spark' }).click();
  await expect(sheet(page, 'New Spark')).toBeVisible();
  await animationsSettled(page);
  const sheetScan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.tm-sheet')
    .analyze();
  expect(sheetScan.violations).toEqual([]);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(sparks(page).getByRole('button', { name: /^Open Bolt's chat/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const cards = await sparks(page)
    .locator('.tm-card')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(cards[0]).toBe(cards[1]);
  await sparks(page).getByRole('button', { name: 'New Spark' }).click();
  const box = await sheet(page, 'New Spark').boundingBox();
  expect(box?.width).toBe(375);
  await page.screenshot({ path: `${SHOTS}/phone-sheet.png` });
});
