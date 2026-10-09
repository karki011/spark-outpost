import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  expectInsideViewport,
  expectNoSidewaysScroll,
  openTouch,
  PHONE,
} from './responsive-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const NAME = 'Orders launch';
const TURN_TIMEOUT = 45_000;
const LONG_ASK = Array.from({ length: 220 }, (_, index) => `word${index}`).join(' ');
const POSTS_URL = /\/api\/outposts\/[^/]+\/posts$/;
const CANCEL_URL = /\/api\/outposts\/[^/]+\/posts\/[^/]+\/cancel$/;
const MEMBER_URL = /\/api\/outposts\/[^/]+\/members\/[^/]+$/;

interface Member {
  conversationId: string;
  handle: string;
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const outpostsSection = (page: Page) => sidebar(page).getByRole('region', { name: 'Outposts' });
const outpostRow = (page: Page, name: string) =>
  outpostsSection(page).getByRole('button', { name: new RegExp(`^${name}`) });
const outpostPage = (page: Page, name: string) =>
  page.getByRole('main', { name: `Outpost ${name}` });
const box = (page: Page) => page.getByRole('combobox', { name: 'Message the outpost' });
const sendButton = (page: Page) => page.locator('.op-send');
const thread = (page: Page) => page.getByRole('list', { name: 'Outpost thread' });
const post = (page: Page, text: string) => thread(page).locator('.op-post', { hasText: text });
const stateOf = (item: Locator) => item.locator('.op-state');
const strip = (page: Page) => page.getByRole('toolbar', { name: 'Chats in this outpost' });
const chip = (page: Page, handle: string) =>
  strip(page).getByRole('button', { name: new RegExp(`^@${handle}\\b`) });
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });
const toast = (page: Page, text: string) =>
  sidebar(page).getByRole('status').filter({ hasText: text });

async function seeded(page: Page, handles: ('fe' | 'api')[] = ['fe', 'api']): Promise<void> {
  const [frontend, api] = await seedChats([
    { title: 'Frontend' },
    { title: 'Orders API' },
    { title: 'Docs site' },
  ]);
  if (!frontend || !api) throw new Error('The chats were not seeded.');
  await openChats(page);
  const chats = { fe: frontend, api };
  const members: Member[] = handles.map((handle) => ({ conversationId: chats[handle], handle }));
  const created = await page.request.post('/api/outposts', {
    data: { id: randomUUID(), name: NAME, members },
  });
  expect(created.ok()).toBe(true);
  await openChats(page);
}

async function openOutpost(page: Page, name = NAME): Promise<Locator> {
  await outpostRow(page, name).click();
  const main = outpostPage(page, name);
  await expect(main).toBeVisible();
  return main;
}

async function say(page: Page, text: string): Promise<void> {
  await box(page).fill(text);
  await box(page).press('Enter');
}

async function addChat(page: Page, dialog: Locator, title: string): Promise<Locator> {
  await dialog.getByRole('button', { name: 'Add a chat' }).click();
  await page
    .getByRole('menu', { name: 'Add a chat' })
    .getByRole('menuitemradio', { name: new RegExp(`^${title}`) })
    .click();
  return dialog.getByRole('textbox', { name: `Handle for ${title}` });
}

function requestsTo(page: Page, url: RegExp, method: string): Request[] {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === method && url.test(request.url())) seen.push(request);
  });
  return seen;
}

test('creates an outpost from the sidebar with a name, two chats and their handles', async ({
  page,
}) => {
  await seedChats([{ title: 'Frontend' }, { title: 'Orders API' }]);
  await openChats(page);
  const opener = outpostsSection(page).getByRole('button', { name: 'New outpost' });
  await opener.click();
  const dialog = sheet(page, 'New outpost');
  const name = dialog.getByRole('textbox', { name: /^Name/ });
  await expect(name).toBeFocused();
  await expect(dialog).toContainText('A new chat can be added after its first message.');

  await dialog.getByRole('button', { name: 'Create outpost' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await expect(name).toBeFocused();
  await name.fill(NAME);

  const frontend = await addChat(page, dialog, 'Frontend');
  await expect(frontend).toHaveValue('frontend');
  const api = await addChat(page, dialog, 'Orders API');
  await expect(api).toHaveValue('orders-api');
  await expect(dialog.getByText('No other chats to add.')).toBeVisible();

  await api.fill('frontend');
  await dialog.getByRole('button', { name: 'Create outpost' }).click();
  await expect(dialog.getByText('@frontend is already used in this outpost.')).toHaveCount(2);
  await expect(outpostsSection(page).getByRole('listitem')).toHaveCount(0);

  await frontend.fill('fe');
  await api.fill('api');
  await dialog.getByRole('button', { name: 'Create outpost' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  const main = outpostPage(page, NAME);
  await expect(main).toBeVisible();
  await expect(outpostRow(page, NAME)).toHaveAttribute('aria-current', 'page');
  await expect(main.getByRole('button', { name: /^You and 2 chats/ })).toBeVisible();
  await expect(thread(page).locator('.op-notice')).toHaveText([
    '@fe joined.',
    '@api joined. @fe and @api can now ask each other.',
  ]);
  await expect(chip(page, 'fe')).toBeVisible();
  await expect(chip(page, 'api')).toBeVisible();
});

test('typing @ offers the handles and the send button says what will happen', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await expect(sendButton(page)).toHaveText('Post note');
  await expect(sendButton(page)).toBeDisabled();

  await box(page).pressSequentially('@');
  const picker = page.getByRole('listbox', { name: 'Chats in this outpost' });
  await expect(picker.getByRole('option')).toHaveText([/^@fe/, /^@api/]);
  await expect(picker.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await box(page).press('ArrowDown');
  await expect(picker.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('Enter');
  await expect(picker).toBeHidden();
  await expect(box(page)).toHaveValue('@api ');
  await expect(thread(page).locator('.op-post')).toHaveCount(0);

  await box(page).pressSequentially('what is the orders shape?');
  await expect(sendButton(page)).toHaveText('Send request');
  await expect(sendButton(page)).toBeEnabled();
  await expect(page.locator('.op-hint')).toHaveText('Starts a turn in @api');

  await box(page).fill('The orders response is now paged.');
  await expect(sendButton(page)).toHaveText('Post note');
  await box(page).fill('@nobody hello');
  await expect(page.locator('.op-hint')).toHaveText(
    'No chat here is called @nobody. This posts as a note.',
  );
});

test('a request is Sent, then Working, then Answered with the answer under it @packaged', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(POSTS_URL, async (route) => {
    await held;
    await route.continue();
  });

  await say(page, '@api What does the orders response look like?');
  const request = post(page, 'What does the orders response look like?');
  await expect(stateOf(request)).toHaveText('Sent');
  await expect(request.locator('.op-reason')).toHaveText('Not sent yet');
  await expect(box(page)).toHaveValue('');

  release();
  await expect(stateOf(request)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  await expect(chip(page, 'api')).toContainText('Working');
  await expect(stateOf(request)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  const answer = request.locator('.op-reply');
  await expect(answer).toContainText('@api');
  await expect(answer).toContainText('This reply comes from the fake provider');
  await expect(request.getByRole('button', { name: /^Cancel request/ })).toHaveCount(0);
  await expect(thread(page).locator('.op-post')).toHaveCount(1);
});

test('a note is posted with no state and starts no work', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, 'The orders response is now paged.');
  const note = post(page, 'The orders response is now paged.');
  await expect(note).toBeVisible();
  await expect(note.locator('.op-kind')).toHaveText('note');
  await expect(stateOf(note)).toHaveCount(0);
  await openChats(page);
  await openOutpost(page);
  await expect(post(page, 'The orders response is now paged.')).toBeVisible();
  await expect(chip(page, 'api')).toContainText('Idle');
  await expect(chip(page, 'fe')).toContainText('Idle');
});

test('a Needs you request is answered from the main message box', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api Deploy the orders service\n\nNeeds you: which region?\n\nThanks');
  const request = post(page, 'Deploy the orders service');
  await expect(stateOf(request)).toHaveText('Needs you', { timeout: TURN_TIMEOUT });
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(`${NAME}, 1 needs you`);

  await request.getByRole('button', { name: 'Answer' }).click();
  const answerBox = page.getByRole('combobox', { name: 'Answer @api' });
  await expect(answerBox).toBeFocused();
  await expect(page.locator('.op-answering')).toHaveText(/Answering\s*@api/);
  await expect(sendButton(page)).toHaveText('Send answer');
  await expect(page.locator('.op-composer textarea')).toHaveCount(1);

  await answerBox.fill('eu-west');
  await answerBox.press('Enter');
  await expect(page.locator('.op-answering')).toHaveCount(0);
  await expect(stateOf(request)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  await expect(request.locator('.op-reply')).toContainText('eu-west');
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(NAME);
});

test('a working request is cancelled with a request that has no content @packaged', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  const cancels = requestsTo(page, CANCEL_URL, 'POST');
  await say(page, `@api Summarise ${LONG_ASK}`);
  const request = post(page, 'Summarise');
  await expect(stateOf(request)).toHaveText('Working', { timeout: TURN_TIMEOUT });

  await request.getByRole('button', { name: 'Cancel request to @api' }).click();
  await expect(stateOf(request)).toHaveText('Cancelled', { timeout: TURN_TIMEOUT });
  await expect(request.getByRole('button', { name: /^Cancel request/ })).toHaveCount(0);
  await expect(request.locator('.op-reply')).toHaveCount(0);
  expect(cancels).toHaveLength(1);
  expect(cancels[0]?.postData() ?? '{}').toBe('{}');
  await expect(chip(page, 'api')).not.toContainText('Working', { timeout: TURN_TIMEOUT });
});

test('pause holds a new request and resume sends it', async ({ page }) => {
  await seeded(page);
  const main = await openOutpost(page);
  await main.getByRole('button', { name: 'Pause' }).click();
  const resume = main.getByRole('button', { name: 'Resume' });
  await expect(resume).toHaveAttribute('aria-pressed', 'true');
  await expect(resume.locator('svg')).toBeVisible();
  await expect(main.getByRole('status').filter({ hasText: 'Paused.' })).toBeVisible();
  await expect(page.locator('.op-hint')).not.toContainText('Paused');

  await box(page).fill('@api ping');
  await expect(page.locator('.op-hint')).toHaveText('Paused. @api gets this when you resume.');
  await box(page).press('Enter');
  const request = post(page, 'ping');
  await expect(stateOf(request)).toHaveText('Sent');
  await expect(request.locator('.op-reason')).toHaveText('Paused');
  await openChats(page);
  await openOutpost(page);
  await expect(stateOf(post(page, 'ping'))).toHaveText('Sent');
  await expect(chip(page, 'api')).toContainText('Idle');
  const results = await new AxeBuilder({ page })
    .include('.main.op')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await outpostPage(page, NAME).getByRole('button', { name: 'Resume' }).click();
  await expect(outpostPage(page, NAME).getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(stateOf(post(page, 'ping'))).toHaveText('Answered', { timeout: TURN_TIMEOUT });
});

test('the member strip moves with the arrow keys and opens a chat', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await chip(page, 'fe').focus();
  await page.keyboard.press('ArrowRight');
  await expect(chip(page, 'api')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(chip(page, 'fe')).toBeFocused();
  await page.keyboard.press('End');
  await expect(chip(page, 'api')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(chip(page, 'fe')).toBeFocused();
  await expect(chip(page, 'fe')).toHaveAttribute('tabindex', '0');
  await expect(chip(page, 'api')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');

  await expect(outpostPage(page, NAME)).toBeHidden();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  await expect(outpostRow(page, NAME)).not.toHaveAttribute('aria-current', 'page');
});

test('a member chat shows the outpost chip and a From you header that opens the post', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api List the order fields');
  await expect(stateOf(post(page, 'List the order fields'))).toHaveText('Answered', {
    timeout: TURN_TIMEOUT,
  });
  await post(page, 'List the order fields')
    .getByRole('button', { name: 'Open @api in chat' })
    .click();

  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  const memberChip = page.getByRole('button', {
    name: `Open outpost ${NAME}. This chat is @api in ${NAME}`,
  });
  await expect(memberChip).toBeVisible();
  const header = page.locator('.bubble.from', { hasText: 'List the order fields' });
  await expect(header.locator('.from-head b')).toHaveText('From you');
  await expect(header.locator('.from-where')).toContainText(NAME);
  await expect(page.locator('.msg.me', { hasText: 'List the order fields' })).toHaveCount(0);

  await header.getByRole('button', { name: 'Open in outpost' }).click();
  await expect(outpostPage(page, NAME)).toBeVisible();
  await expect(outpostRow(page, NAME)).toHaveAttribute('aria-current', 'page');
  await expect(post(page, 'List the order fields')).toBeInViewport();

  await chip(page, 'api').click();
  await memberChip.click();
  await expect(outpostPage(page, NAME)).toBeVisible();
});

test('editing renames the outpost and swaps two handles, and holding deletes it', async ({
  page,
}) => {
  await seeded(page);
  const main = await openOutpost(page);
  const puts = requestsTo(page, MEMBER_URL, 'PUT');
  const edit = main.getByRole('button', { name: 'Edit outpost' });
  await edit.click();
  const dialog = sheet(page, 'Edit outpost');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Orders relaunch');
  await dialog.getByRole('textbox', { name: 'Handle for Frontend' }).fill('api');
  await dialog.getByRole('textbox', { name: 'Handle for Orders API' }).fill('fe');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const renamed = outpostPage(page, 'Orders relaunch');
  await expect(renamed.getByRole('heading', { level: 1 })).toHaveText('Orders relaunch');
  await expect(renamed.getByRole('button', { name: 'Edit outpost' })).toBeFocused();
  await expect(outpostRow(page, 'Orders relaunch')).toHaveAttribute('aria-current', 'page');
  await expect(strip(page).getByRole('button').filter({ hasText: 'Frontend' })).toContainText(
    '@api',
  );
  await expect(strip(page).getByRole('button').filter({ hasText: 'Orders API' })).toContainText(
    '@fe',
  );
  expect(puts.map((put) => (put.postDataJSON() as { handle: string }).handle)).toEqual([
    'api2',
    'fe',
    'api',
  ]);

  await renamed.getByRole('button', { name: 'Edit outpost' }).click();
  const hold = sheet(page, 'Edit outpost').getByRole('button', { name: 'Hold to delete outpost' });
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(renamed).toBeHidden({ timeout: 10_000 });
  await page.keyboard.up(' ');
  await expect(outpostsSection(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.locator('.chat-title')).toBeVisible();
  await expect(sidebar(page).getByRole('listitem').filter({ hasText: 'Frontend' })).toBeVisible();
});

test('an outpost request waiting in a chat queue can be removed but not edited', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, `@api First ${LONG_ASK}`);
  await expect(stateOf(post(page, 'First word0'))).toHaveText('Working', {
    timeout: TURN_TIMEOUT,
  });
  await say(page, '@api Second ask');
  await expect(stateOf(post(page, 'Second ask'))).toHaveText('Sent');

  await chip(page, 'api').click();
  const queued = page.getByRole('list', { name: 'Queued messages' }).getByRole('listitem');
  await expect(queued).toHaveCount(1);
  await expect(queued.first()).toContainText('Outpost request');
  await expect(queued.first()).toContainText('Second ask');
  await expect(queued.first().getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await queued.first().getByRole('button', { name: 'Remove' }).click();
  await expect(queued).toHaveCount(0);

  await page.getByRole('button', { name: new RegExp(`^Open outpost ${NAME}`) }).click();
  await expect(stateOf(post(page, 'Second ask'))).toHaveText('Cancelled', {
    timeout: TURN_TIMEOUT,
  });
  await post(page, 'First word0').getByRole('button', { name: 'Cancel request to @api' }).click();
  await expect(stateOf(post(page, 'First word0'))).toHaveText('Cancelled', {
    timeout: TURN_TIMEOUT,
  });
});

test('adds a chat to an outpost from its row menu with the keyboard', async ({ page }) => {
  await seeded(page, ['fe']);
  const options = sidebar(page).getByRole('button', { name: 'Options for Docs site' });
  await options.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Options for Docs site' });
  await menu.getByRole('menuitem', { name: 'Add to outpost' }).focus();
  await page.keyboard.press('ArrowRight');
  const outposts = page.getByRole('menu', { name: 'Add to outpost' });
  await expect(outposts.getByRole('menuitem', { name: new RegExp(`^${NAME}`) })).toContainText(
    '1 chat',
  );
  await outposts.getByRole('menuitem', { name: new RegExp(`^${NAME}`) }).focus();
  await page.keyboard.press('Enter');

  const handles = page.getByRole('menu', { name: `Add to ${NAME}` });
  const handle = handles.getByRole('textbox', { name: 'Handle' });
  await expect(handle).toBeFocused();
  await expect(handle).toHaveValue('docs-site');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('fe');
  await expect(handles.getByRole('alert')).toHaveText('@fe is already used in this outpost.');
  await page.keyboard.press('Enter');
  await expect(handles).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('docs');
  await page.keyboard.press('Enter');

  await expect(handles).toBeHidden();
  await expect(toast(page, 'Added Docs site as @docs')).toBeVisible();
  await expect(options).toBeFocused();
  await openOutpost(page);
  await expect(chip(page, 'docs')).toBeVisible();
  await expect(thread(page).locator('.op-notice').last()).toHaveText(
    '@docs joined. @fe and @docs can now ask each other.',
  );

  await chip(page, 'docs').click();
  await expect(
    page.getByRole('button', { name: new RegExp(`^Open outpost ${NAME}\\. This chat is @docs`) }),
  ).toBeVisible();
  await options.click();
  await expect(
    page
      .getByRole('menu', { name: 'Options for Docs site' })
      .getByRole('menuitem', { name: 'Add to outpost' }),
  ).toHaveCount(0);
});

test('an outpost fits a phone with no sideways page scroll', async ({ browser, page }) => {
  await seeded(page);
  const phone = await openTouch(browser, PHONE, 'chats');
  try {
    await phone.getByRole('button', { name: /^(Open|Show) sidebar/ }).click();
    await outpostRow(phone, NAME).click();
    const main = outpostPage(phone, NAME);
    await expect(main).toBeVisible();
    await expectNoSidewaysScroll(phone);
    await expectInsideViewport(phone, box(phone));
    await expectInsideViewport(phone, main.getByRole('button', { name: 'Pause' }));

    await say(phone, `A note with a long unbroken token ${'x'.repeat(120)}`);
    await expect(post(phone, 'A note with a long unbroken token')).toBeVisible();
    await expectNoSidewaysScroll(phone);
    await box(phone).fill('@');
    await expect(phone.getByRole('listbox', { name: 'Chats in this outpost' })).toBeVisible();
    await expectNoSidewaysScroll(phone);
  } finally {
    await phone.context().close();
  }
});
