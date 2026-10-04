import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.SPARK_MENTION_SHOTS ?? 'test-results/spark-mention';
const shot = (name: string) => `${SHOTS}/spark-mention-${name}.png`;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  for (const data of [
    { name: 'Pip', role: 'Code reviewer', instructions: 'Point to the file and line.' },
    { name: 'Wren', role: 'Docs writer', instructions: 'Write short, plain sentences.' },
  ]) {
    expect((await page.request.post('/api/teammates', { data })).status()).toBe(201);
  }
});

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();
  return input;
}

const suggestion = (page: Page) => page.getByRole('group', { name: 'Spark suggestion' });
const sparkList = (page: Page) => page.getByRole('listbox', { name: 'Sparks' });
const scan = (page: Page, selector: string) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).include(selector).analyze();

test('suggests the matching Spark, stays quiet once dismissed, and applies on click', async ({
  page,
}) => {
  const input = await newChat(page);
  await expect(input).toHaveAttribute('placeholder', /@ to hand a job to a Spark/);

  await input.fill('add a dark mode toggle');
  await expect(suggestion(page)).toHaveCount(0);

  await input.fill('review this PR');
  const ask = suggestion(page).getByRole('button', { name: 'Ask Pip (Code reviewer)?' });
  await expect(ask).toBeVisible();
  expect((await scan(page, '.ctxbar')).violations).toEqual([]);
  await page.screenshot({ path: shot('suggestion-chip') });

  await suggestion(page).getByRole('button', { name: 'Dismiss the suggestion to ask Pip' }).click();
  await expect(suggestion(page)).toHaveCount(0);
  await input.fill('review this PR please');
  await expect(suggestion(page)).toHaveCount(0);

  await input.fill('');
  await input.fill('review this PR');
  await expect(ask).toBeVisible();
  await ask.focus();
  await page.keyboard.press('Enter');

  await expect(input).toHaveValue('@Pip review this PR');
  await expect(input).toBeFocused();
  await expect(suggestion(page)).toHaveCount(0);
});

test('@ opens a keyboard picker of Sparks and inserts the mention', async ({ page }) => {
  const input = await newChat(page);

  await input.pressSequentially('Hey @');
  const options = sparkList(page).getByRole('option');
  await expect(options).toHaveText([/Pip.*Code reviewer/, /Wren.*Docs writer/]);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.mentionpop')).toContainText('hands this one job to that Spark');
  expect((await scan(page, '.mentionpop')).violations).toEqual([]);
  await page.screenshot({ path: shot('picker') });

  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(1).getAttribute('id'))!,
  );
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(sparkList(page)).toBeHidden();
  await expect(input).toHaveValue('Hey @');

  await input.fill('');
  await input.pressSequentially('@w');
  await expect(options).toHaveText([/Wren/]);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('@Wren ');
  await expect(sparkList(page)).toBeHidden();
  await expect(input).toBeFocused();

  await input.fill('');
  await input.pressSequentially('mail me@nowhere');
  await expect(sparkList(page)).toBeHidden();
});

test('a mention runs the Spark as its own labelled turn and skips the main agent', async ({
  page,
}) => {
  const input = await newChat(page);
  await input.fill('@Pip review the login change');
  await input.press('Enter');

  const turn = page.locator('section[data-turn]').first();
  await expect(turn.locator('.msg-sparks')).toHaveText(/Handed to\s*Pip\s*Code reviewer/);
  const block = turn.locator('.agent-block');
  await expect(block).toHaveCount(1);
  await expect(block.locator('.agent-name')).toHaveText('Pip');
  await expect(block.locator('.agent-role')).toHaveText('Code reviewer');
  await expect(block.locator('.md')).toContainText('review the login change', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  await expect(turn.locator('.provider-name')).toHaveCount(0);
  await expect(turn).not.toContainText('Hand-off note');
  expect((await scan(page, 'section[data-turn]')).violations).toEqual([]);
  await page.screenshot({ path: shot('turn') });

  await page.reload();
  const again = page.locator('section[data-turn]').first();
  await expect(again.locator('.msg-sparks')).toHaveText(/Handed to\s*Pip\s*Code reviewer/);
  await expect(again.locator('.agent-block .md')).toContainText('review the login change');

  const sparks = (await (await page.request.get('/api/teammates')).json()) as {
    teammates: { id: string; name: string }[];
  };
  const pip = sparks.teammates.find((entry) => entry.name === 'Pip')!;
  expect((await page.request.delete(`/api/teammates/${pip.id}`, { data: {} })).status()).toBe(204);
  await page.reload();
  await expect(page.locator('section[data-turn]').first().locator('.msg-sparks')).toHaveText(
    /Handed to\s*Pip\s*Code reviewer/,
  );
});

test('the main agent continues with a hand-off note when the message hands the work back', async ({
  page,
}) => {
  const input = await newChat(page);
  await input.fill('@Pip review the login change, then summarise it');
  await input.press('Enter');

  const turn = page.locator('section[data-turn]').first();
  const blocks = turn.locator('.agent-block[data-agent]');
  await expect(blocks.first().locator('.agent-role')).toHaveText('Code reviewer', {
    timeout: 20_000,
  });
  await expect(blocks).toHaveCount(2, { timeout: 30_000 });
  await expect(blocks.last().locator('.md')).toContainText('Hand-off note from Spark Outpost', {
    timeout: 30_000,
  });
  await expect(blocks.last().locator('.agent-role')).not.toHaveText('Code reviewer');
  await page.screenshot({ path: shot('turn-then-main') });
});
