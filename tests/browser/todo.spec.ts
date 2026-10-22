import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { allowEdit, chatRepo, projectChat, resetWithAgents, turnDone } from './project-chat-kit.ts';

const PR_TITLE = 'spark-outpost/demo#42';
const WIDE = { width: 2000, height: 1100 };

const thread = (page: Page) => page.locator('.thread section[aria-label="Turn"]');
const turns = (page: Page) => page.locator('.thread section[aria-label="Turn"]');
const rail = (page: Page) => page.getByRole('region', { name: 'Chat context' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
});

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

async function finished(page: Page, count: number) {
  await expect(turns(page)).toHaveCount(count, { timeout: 20_000 });
  await expect(stop(page)).toHaveCount(0, { timeout: 30_000 });
}

test("the agent's to-do ticks live in the turn, then folds to one line", async ({ page }) => {
  await send(page, 'Fix the date divider #plan #slow');
  const card = thread(page).getByRole('region', { name: "This turn's to-do" });
  await expect(card).toContainText('0 of 3', { timeout: 15_000 });
  await expect(card.getByRole('img', { name: 'Working' })).toHaveCount(1);
  const before = await card.boundingBox();
  await page.addStyleTag({ content: '.thread .col { padding-bottom: 200vh; }' });
  await page.locator('.thread').evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(page.locator('.cs-todo')).toHaveText('Read the request');

  await expect(page.locator('.cs-todo')).toHaveText('Look through the code', { timeout: 15_000 });
  await page.locator('.thread').evaluate((element) => (element.scrollTop = 0));
  await expect(card).toContainText('1 of 3');
  await expect(card.getByRole('img', { name: 'Done' })).toHaveCount(1);
  expect((await card.boundingBox())?.height).toBe(before?.height);
  const after = await card.boundingBox();
  expect(after?.height).toBe(before?.height);

  await finished(page, 1);
  await expect(card).toHaveCount(0);
  const line = thread(page).getByRole('button', { name: 'To-do: 3 of 3 done' });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await line.focus();
  await page.keyboard.press('Enter');
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  const items = thread(page).getByRole('list', { name: 'To-do items' });
  await expect(items.getByRole('listitem')).toHaveText([
    'Read the request',
    'Look through the code',
    'Write the answer',
  ]);
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(items).toHaveCount(0);
});

test('each turn shows only its own items and the rail shows the latest list', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await send(page, 'Fix the date divider #plan #slow');
  const card = thread(page).getByRole('region', { name: "This turn's to-do" });
  await expect(card).toContainText('1 of 3', { timeout: 20_000 });
  await stop(page).click();
  await finished(page, 1);
  const first = turns(page).nth(0);
  await expect(
    first.getByRole('button', { name: 'To-do: 1 of 3 done · 2 not finished' }),
  ).toBeVisible();

  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    /^Ask anything/,
  );
  await send(page, 'Now finish it #plan');
  await finished(page, 2);
  const second = turns(page).nth(1).getByRole('button', { name: 'To-do: 2 of 2 done' });
  await expect(second).toBeVisible();
  await second.click();
  await expect(
    turns(page).nth(1).getByRole('list', { name: 'To-do items' }).getByRole('listitem'),
  ).toHaveText(['Look through the code', 'Write the answer']);
  await expect(
    first.getByRole('button', { name: 'To-do: 1 of 3 done · 2 not finished' }),
  ).toBeVisible();

  const todo = rail(page).getByRole('region', { name: 'To-do' });
  await expect(todo.getByRole('button', { name: /^3 of 3 to-do items done/ })).toHaveText('3 of 3');
  await expect(todo.getByRole('list', { name: 'To-do items' }).getByRole('listitem')).toHaveCount(
    3,
  );
  await expect(rail(page)).not.toContainText('Understood the request');
  await expect(rail(page)).not.toContainText('Worked on the request');

  await page.reload();
  await expect(
    turns(page).nth(0).getByRole('button', { name: 'To-do: 1 of 3 done · 2 not finished' }),
  ).toBeVisible();
});

test('a turn without a to-do shows no card and no To-do anywhere', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await send(page, 'Just saying hello');
  await finished(page, 1);
  await expect(page.locator('.todo-card, .todo-line')).toHaveCount(0);
  await expect(rail(page).getByRole('region', { name: 'To-do' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show work panel' })).toHaveCount(0);
});

test('the work panel shows the to-do with its history, and links stay under Links', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await send(page, 'Fix the date divider #plan');
  await finished(page, 1);

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'To-do', level: 2 })).toBeVisible();
  await expect(panel(page).getByRole('tab')).toHaveText(['To-do', 'Links', 'Changes', 'Cost']);
  const list = panel(page).getByRole('list', { name: 'To-do items' });
  await expect(list.getByRole('listitem')).toHaveText([
    'Read the request',
    'Look through the code',
    'Write the answer',
  ]);
  await expect(panel(page)).not.toContainText('Made a plan');
  await expect(panel(page).getByText('used by Claude · 1 turn')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Copy as Markdown' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# Plan v1');

  await panel(page).getByRole('tab', { name: 'Links' }).click();
  const pr = panel(page).getByRole('link', { name: new RegExp(PR_TITLE) });
  await expect(pr).toHaveAttribute('href', 'https://github.com/spark-outpost/demo/pull/42');

  await send(page, 'Thanks, and one more thing');
  await finished(page, 2);
  await panel(page).getByRole('tab', { name: 'To-do' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(panel(page)).not.toContainText('Follow-up');
});

test('on a phone the work panel opens as a bottom sheet on the to-do', async ({ page }) => {
  await send(page, 'Fix the date divider #plan');
  await finished(page, 1);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(panel(page)).toBeHidden();
  await expect(thread(page).getByRole('button', { name: 'To-do: 3 of 3 done' })).toBeVisible();

  await page.getByRole('button', { name: 'Show work panel' }).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'To-do', level: 2 })).toBeFocused();
  await expect
    .poll(async () => {
      const box = await panel(page).boundingBox();
      return box ? [box.y > 80, Math.round(box.y + box.height)] : null;
    })
    .toEqual([true, 800]);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test('a chat with approvals but no list shows them as Recorded, not as a to-do', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetWithAgents();
  const repo = chatRepo();
  try {
    await projectChat(page, repo, 'Ask before edits');
    await send(page, 'Fix the divider #build');
    await allowEdit(page);
    await turnDone(page, 60_000);
    await expect(page.locator('.todo-card, .todo-line')).toHaveCount(0);
    const show = page.getByRole('button', { name: 'Show work panel' }).first();
    if (await show.isVisible()) await show.click();
    await expect(panel(page).getByRole('tab', { name: 'To-do' })).toHaveCount(0);
    await panel(page).getByRole('tab', { name: 'Recorded' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Recorded by Spark' })).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Latest list' })).toHaveCount(0);
  } finally {
    repo.remove();
  }
});
