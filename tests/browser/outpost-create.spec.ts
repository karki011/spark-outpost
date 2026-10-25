import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  NAME,
  NEW_OUTPOST,
  TURN_TIMEOUT,
  chip,
  newOutpost,
  openThread,
  outpostPage,
  outpostRow,
  outpostsSection,
  pick,
  post,
  proceed,
  seeded,
  sheet,
  startButton,
  stateOf,
  stepNow,
  thread,
  threadPane,
} from './outposts-kit.ts';
import { expectNoSidewaysScroll, openTouch, PHONE } from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';

let base: string;

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  base = mkdtempSync(path.join(tmpdir(), 'spark-outpost-create-'));
});

test.afterEach(() => rmSync(base, { recursive: true, force: true }));

async function createProject(page: Page, name: string) {
  const folder = path.join(base, name);
  mkdirSync(folder);
  const response = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; name: string };
}

const notices = (page: Page) => thread(page).locator('.op-notice');

test('two existing chats become an outpost with the keyboard alone', async ({ page }) => {
  await seedChats([{ title: 'Frontend' }, { title: 'Orders API' }]);
  await openChats(page);
  const opener = outpostsSection(page).getByRole('button', { name: NEW_OUTPOST });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = sheet(page, NEW_OUTPOST);
  const name = dialog.getByRole('textbox', { name: /^Name/ });
  await expect(name).toBeFocused();
  await expect(stepNow(dialog)).toContainText('Name');

  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await page.keyboard.type(NAME);
  await page.keyboard.press('Enter');
  await expect(stepNow(dialog)).toContainText('Chats');

  const chatField = dialog.getByRole('button', { name: 'Chat', exact: true });
  await expect(chatField).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Chat' });
  await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('Enter');
  const add = dialog.getByRole('button', { name: 'Add another chat' });
  await expect(add).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: /^Handle for / })).toHaveCount(1);

  await page.keyboard.press('Enter');
  await expect(chatField).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(add).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Handle for Frontend' })).toHaveValue(
    'frontend',
  );
  await expect(dialog.getByRole('textbox', { name: 'Handle for Orders API' })).toHaveValue(
    'orders-api',
  );
  await expect(dialog.getByText('2 chats', { exact: true })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(stepNow(dialog)).toContainText('Review');
  await expect(dialog.getByText('Each chat works under its own mode.')).toBeVisible();
  await expect(dialog.getByText(/^Creates/)).toHaveCount(0);
  await expect(startButton(dialog)).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  const main = outpostPage(page, NAME);
  await expect(main).toBeVisible();
  await expect(outpostRow(page, NAME)).toHaveAttribute('aria-current', 'page');
  await expect(
    main.getByRole('toolbar', { name: 'Chats in this outpost' }).getByRole('button'),
  ).toHaveCount(2);
  await expect(notices(page)).toHaveCount(2);
  await expect(notices(page).filter({ hasText: '@frontend joined · Claude Opus 5.5' })).toHaveCount(
    1,
  );
  await expect(notices(page).filter({ hasText: 'ask each other' })).toHaveCount(0);
  await expect(notices(page).locator('.chat-face')).toHaveCount(2);
  await expect(chip(page, 'frontend')).toBeVisible();
  await expect(chip(page, 'orders-api')).toBeVisible();
});

test('a new chat with a first message and a file starts working when the outpost starts @packaged', async ({
  page,
}) => {
  await openChats(page);
  const project = await createProject(page, 'storefront');
  await page.reload();
  const contract = path.join(base, 'usage-contract.md');
  writeFileSync(contract, '# Usage contract\nAn unknown user returns 404.\n');
  const dialog = await newOutpost(page, NAME);

  await dialog.getByRole('radio', { name: 'New chat' }).click();
  await expect(proceed(dialog)).toBeEnabled();
  await pick(page, dialog, 'Project', project.name);
  await expect(dialog.getByRole('textbox', { name: 'Handle', exact: true })).toHaveValue(
    'storefront',
  );
  await expect(dialog.getByRole('button', { name: 'Agent: Claude Opus 5.5' })).toBeVisible();
  await dialog.getByRole('button', { name: /^Permissions: / }).click();
  await page
    .getByRole('dialog', { name: /^Permissions/ })
    .getByRole('radio', { name: 'Accept edits' })
    .click();
  await expect(dialog.getByRole('button', { name: 'Permissions: Accept edits' })).toBeFocused();

  await dialog.getByRole('button', { name: /Add a first message/ }).click();
  const message = dialog.getByRole('textbox', { name: /^First message/ });
  await expect(message).toBeFocused();
  await message.fill('Add an optional userId filter and follow the attached contract.');
  await dialog.getByLabel('Attach files').setInputFiles(contract);
  await expect(dialog.locator('.att-chip', { hasText: 'usage-contract.md' })).toBeVisible();
  await expect(dialog.locator('.att-chip[aria-busy="true"]')).toHaveCount(0);
  await expect(dialog.getByText('Continue adds the open chat')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add chat' }).click();

  const row = dialog.locator('.op-chat-row');
  await expect(row).toContainText('New chat in storefront');
  await expect(row).toContainText('storefront · Claude Opus 5.5 · Accept edits');
  await expect(row.locator('.op-chat-mark')).toHaveText('First message1 file');

  await dialog.getByRole('button', { name: 'Add another chat' }).click();
  await dialog.getByRole('radio', { name: 'New chat' }).click();
  await pick(page, dialog, 'Project', project.name);
  await expect(dialog.getByRole('textbox', { name: 'Handle', exact: true })).toHaveValue(
    'storefront2',
  );
  await proceed(dialog).click();

  await expect(stepNow(dialog)).toContainText('Review');
  await expect(dialog.getByText('Creates 2 new chats')).toBeVisible();
  await expect(dialog.getByText('Sends 1 first request')).toBeVisible();
  await expect(dialog.locator('.op-review-message')).toContainText('Add an optional userId filter');
  await expect(dialog.locator('.op-review-files')).toHaveText('1 file');
  const axe = await new AxeBuilder({ page })
    .include('.op-create')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/outposts') && response.request().method() === 'POST',
  );
  await startButton(dialog).click();
  const body = (await (await created).json()) as {
    failed: unknown[];
    posts: { kind: string; state: string | null; files: number }[];
  };
  expect(body.failed).toEqual([]);
  expect(body.posts.filter((sent) => sent.kind === 'request')).toMatchObject([
    { state: 'sent', files: 1 },
  ]);

  await expect(dialog).toBeHidden();
  await expect(outpostPage(page, NAME)).toBeVisible();
  const intro = notices(page).filter({ hasText: '@storefront joined' });
  await expect(intro.locator('.op-intro-line')).toHaveText(
    '@storefront joined · storefront · Claude Opus 5.5 · Accept edits',
  );
  await expect(intro.locator('.op-intro-task')).toHaveText(
    'Task: Add an optional userId filter and follow the attached contract.',
  );
  await expect(notices(page).filter({ hasText: '@storefront2 joined' })).toHaveCount(1);

  const request = post(page, 'Add an optional userId filter');
  await expect(request).toContainText('You');
  await expect(request.locator('.op-attached')).toHaveText('1 file');
  await expect(stateOf(request)).toHaveText(/Working|Idle/, { timeout: TURN_TIMEOUT });
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  await expect(thread(page).locator('.op-post')).toHaveCount(1);

  await expect(chip(page, 'storefront2')).toBeVisible();
  await chip(page, 'storefront2').click();
  await page.getByRole('button', { name: /^Chat details/ }).click();
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Open outpost ${NAME}\\. This chat is @storefront2`),
    }),
  ).toBeVisible();
  await outpostRow(page, NAME).click();
  await openThread(request, 'storefront');
  await threadPane(page, 'storefront')
    .getByRole('button', { name: 'Open @storefront in chat' })
    .click();
  await expect(page.locator('.msg-atts', { hasText: 'usage-contract.md' }).first()).toBeVisible();
});

test('the chats step says what is wrong and holds Continue until it is fixed', async ({ page }) => {
  await seeded(page);
  await createProject(page, 'storefront');
  await page.reload();
  const dialog = await newOutpost(page, 'Second room');

  await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
  const taken = page.getByRole('menu', { name: 'Chat' }).getByRole('menuitemradio', {
    name: /^Frontend/,
  });
  await expect(taken).toBeDisabled();
  await expect(taken).toContainText(`Already in ${NAME}. A chat belongs to one outpost.`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await pick(page, dialog, 'Chat', 'Docs site');
  await dialog.getByRole('button', { name: 'Add another chat' }).click();
  await dialog.getByRole('radio', { name: 'New chat' }).click();
  const handle = dialog.getByRole('textbox', { name: 'Handle', exact: true });
  await handle.fill('docs-site');
  await expect(proceed(dialog)).toBeDisabled();
  await expect(dialog.getByText('2 things to fix')).toBeVisible();
  await expect(dialog.getByText('A new chat needs a project.')).toBeVisible();
  await expect(dialog.getByText(/Two chats cannot share @docs-site\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add chat' })).toBeDisabled();

  await dialog.getByRole('button', { name: '@docs-site2' }).click();
  await expect(handle).toHaveValue('docs-site2');
  await expect(dialog.getByText('1 thing to fix')).toBeVisible();
  await pick(page, dialog, 'Project', 'storefront');
  await expect(proceed(dialog)).toBeEnabled();
  await expect(handle).toHaveValue('docs-site2');
});

test('Back keeps what was entered and closing asks before discarding it', async ({ page }) => {
  await seedChats([{ title: 'Frontend' }]);
  await openChats(page);
  const dialog = await newOutpost(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const again = await newOutpost(page, NAME);
  await pick(page, again, 'Chat', 'Frontend');
  await again.getByRole('textbox', { name: 'Handle for Frontend' }).fill('fe');
  await proceed(again).click();
  await expect(stepNow(again)).toContainText('Review');
  await again.getByRole('button', { name: 'Back' }).click();
  await expect(again.getByRole('textbox', { name: 'Handle for Frontend' })).toHaveValue('fe');
  await again.getByRole('button', { name: 'Back' }).click();
  await expect(again.getByRole('textbox', { name: /^Name/ })).toHaveValue(NAME);
  await expect(again.getByRole('textbox', { name: /^Name/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(again.getByText('Discard this outpost?')).toBeVisible();
  await expect(again.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(again.getByText('Discard this outpost?')).toBeHidden();
  await again.getByRole('button', { name: 'Close' }).click();
  await again.getByRole('button', { name: 'Discard' }).click();
  await expect(again).toBeHidden();
  await expect(outpostsSection(page).getByRole('listitem')).toHaveCount(0);
});

test('at phone width the steps fill the screen and the fields stack', async ({ browser, page }) => {
  await openChats(page);
  await createProject(page, 'storefront');
  const phone = await openTouch(browser, PHONE, 'chats');
  try {
    await phone.getByRole('button', { name: /^(Open|Show) sidebar/ }).click();
    const dialog = await newOutpost(phone, NAME);
    await dialog.getByRole('radio', { name: 'New chat' }).click();

    const size = await dialog.boundingBox();
    expect(size?.width).toBe(PHONE.width);
    expect(size?.height).toBe(PHONE.height);
    const project = await dialog.getByRole('button', { name: 'Project' }).boundingBox();
    const agent = await dialog.getByRole('button', { name: /^Agent/ }).boundingBox();
    expect(agent!.x).toBe(project!.x);
    expect(agent!.y).toBeGreaterThan(project!.y + project!.height);
    await expectNoSidewaysScroll(phone);
    await pick(phone, dialog, 'Project', 'storefront');
    await dialog.getByRole('button', { name: /Add a first message/ }).click();
    await expectNoSidewaysScroll(phone);
    await expect(proceed(dialog)).toBeInViewport();
  } finally {
    await phone.context().close();
  }
});
