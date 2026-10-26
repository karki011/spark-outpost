import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedChats } from './sidebar-seed.ts';
import {
  CANCEL_URL,
  LONG_ASK,
  MEMBER_URL,
  NAME,
  POSTS_URL,
  TURN_TIMEOUT,
  asPairedPhone,
  asksLine,
  box,
  cancelRequest,
  cardOf,
  expectTopmost,
  chip,
  openOutpost,
  openSettings,
  openThread,
  outpostPage,
  outpostRow,
  outpostsSection,
  post,
  postNotes,
  requestsTo,
  say,
  seeded,
  sendButton,
  sheet,
  sidebar,
  stateOf,
  strip,
  thread,
  threadPane,
  toast,
} from './outposts-kit.ts';
import {
  expectInsideViewport,
  expectNoSidewaysScroll,
  openTouch,
  PHONE,
} from './responsive-kit.ts';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('typing @ offers the handles and the send button says what will happen', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await expect(sendButton(page)).toHaveText('Send message');
  await expect(sendButton(page)).toBeDisabled();

  await box(page).pressSequentially('@');
  const picker = page.getByRole('listbox', { name: 'Chats in this outpost' });
  await expect(picker.getByRole('option')).toHaveText([/^@fe/, /^@api/]);
  await expect(picker.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expectTopmost(picker);
  await box(page).press('ArrowDown');
  await expect(picker.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('Enter');
  await expect(picker).toBeHidden();
  await expect(box(page)).toHaveValue('@api ');
  await expect(thread(page).locator('.op-post')).toHaveCount(0);

  await box(page).pressSequentially('what is the orders shape?');
  await expect(sendButton(page)).toHaveText('Send request');
  await expect(sendButton(page)).toBeEnabled();
  await expect(asksLine(page)).toHaveText('Asks:@api');

  await box(page).fill('The orders response is now paged.');
  await expect(sendButton(page)).toHaveText('Send message');
  await expect(page.locator('.op-hint')).toContainText('To @fe');
  await box(page).fill('@nobody hello');
  await expect(page.locator('.op-hint')).toHaveText(
    'No chat here is called @nobody. Choose a member or correct the handle.',
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
  await expect(stateOf(request)).toHaveText('Queued');
  await expect(request.locator('.op-card-meta')).toHaveText('Not sent yet');
  await expect(box(page)).toHaveValue('');

  release();
  await expect(stateOf(request)).toHaveText('Working', { timeout: TURN_TIMEOUT });
  await expect(chip(page, 'api')).toContainText('Working');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  const card = cardOf(request);
  await expect(card).toContainText('@api');
  await expect(card.locator('.op-card-meta')).toContainText(
    'This reply comes from the fake provider',
  );
  await expect(request.getByRole('button', { name: /the request to @api…$/ })).toHaveCount(0);
  await expect(thread(page).locator('.op-post')).toHaveCount(1);
});

test('a note is posted with no state and starts no work', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  await page.getByRole('button', { name: 'Message destination' }).click();
  await page.getByRole('menuitemradio', { name: /^Post note/ }).click();
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
  await expect(stateOf(request)).toHaveText('Waiting on you', { timeout: TURN_TIMEOUT });
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(`${NAME}, 1 needs you`);

  await request.getByRole('button', { name: 'Answer @api', exact: true }).click();
  const answerBox = page.getByRole('combobox', { name: 'Answer @api' });
  await expect(answerBox).toBeFocused();
  await expect(page.locator('.op-answering')).toHaveText(/Answering\s*@api/);
  await expect(sendButton(page)).toHaveText('Send answer');
  await expect(page.locator('.op-composer textarea')).toHaveCount(1);

  await answerBox.fill('eu-west');
  await answerBox.press('Enter');
  await expect(page.locator('.op-answering')).toHaveCount(0);
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  await openThread(request, 'api');
  await expect(threadPane(page, 'api')).toContainText('eu-west');
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

  await cancelRequest(request, 'api');
  await expect(stateOf(request)).toHaveText('Cancelled', { timeout: TURN_TIMEOUT });
  await expect(request.getByRole('button', { name: /the request to @api…$/ })).toHaveCount(0);
  await expect(request.locator('.op-card-meta')).toHaveCount(0);
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
  await expect(page.locator('.op-hint')).toHaveText('Paused. @fe gets this when you resume.');

  await box(page).fill('@api ping');
  await expect(asksLine(page)).toContainText('Paused. @api gets this when you resume.');
  await box(page).press('Enter');
  const request = post(page, 'ping');
  await expect(stateOf(request)).toHaveText('Queued');
  await expect(request.locator('.op-card-meta')).toHaveText('Paused');
  await openChats(page);
  await openOutpost(page);
  await expect(stateOf(post(page, 'ping'))).toHaveText('Queued');
  await expect(chip(page, 'api')).toContainText('Idle');
  const results = await new AxeBuilder({ page })
    .include('.main.op')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await outpostPage(page, NAME).getByRole('button', { name: 'Resume' }).click();
  await expect(outpostPage(page, NAME).getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(stateOf(post(page, 'ping'))).toHaveText('Idle', { timeout: TURN_TIMEOUT });
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
  const outpostId = await seeded(page);
  await openOutpost(page);
  await say(page, '@api List the order fields');
  await expect(stateOf(post(page, 'List the order fields'))).toHaveText('Idle', {
    timeout: TURN_TIMEOUT,
  });
  await postNotes(page, outpostId, 16);
  await expect(post(page, 'Filler 16')).toBeInViewport();
  await expect(post(page, 'List the order fields')).not.toBeInViewport();
  await thread(page).evaluate((list) => list.closest('.thread')?.scrollTo(0, 0));
  await openThread(post(page, 'List the order fields'), 'api');
  await threadPane(page, 'api').getByRole('button', { name: 'Open @api in chat' }).click();

  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  const memberChip = page.getByRole('button', {
    name: `Open outpost ${NAME}. This chat is @api in ${NAME}`,
  });
  await expect(memberChip).toBeVisible();
  const header = page.locator('.bubble.from', { hasText: 'List the order fields' });
  await expect(header.locator('.from-head b')).toHaveText('From you');
  await expect(header.locator('.from-where')).toContainText(NAME);
  await expect(page.locator('.msg.me .bubble', { hasText: 'List the order fields' })).toHaveCount(
    1,
  );
  await expect(page.locator('.msg.me .bubble:not(.from)')).toHaveCount(0);
  await expect(header).not.toContainText('outpost-request');
  await expect(header).not.toContainText('[From the user');

  await header.getByRole('button', { name: 'Open in outpost' }).click();
  await expect(outpostPage(page, NAME)).toBeVisible();
  await expect(outpostRow(page, NAME)).toHaveAttribute('aria-current', 'page');
  await expect(post(page, 'List the order fields')).toBeInViewport();
  await expect(cardOf(post(page, 'List the order fields'))).toHaveClass(/\bflash\b/);
  await expect(post(page, 'Filler 16')).not.toBeInViewport();
  await expect(outpostPage(page, NAME).getByRole('button', { name: 'Jump to latest' })).toHaveClass(
    /\bshow\b/,
  );

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
  await expect(main).toBeVisible();
  const dialog = await openSettings(page, NAME);
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Orders relaunch');
  await dialog.getByRole('textbox', { name: 'Handle for Frontend' }).fill('api');
  await dialog.getByRole('textbox', { name: 'Handle for Orders API' }).fill('fe');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const renamed = outpostPage(page, 'Orders relaunch');
  await expect(renamed.getByRole('heading', { level: 1 })).toHaveText('Orders relaunch');
  await expect(renamed.getByRole('button', { name: 'Orders relaunch', exact: true })).toBeFocused();
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

  const settings = await openSettings(page, 'Orders relaunch');
  const hold = settings.getByRole('button', { name: 'Hold to delete outpost' });
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
  await expect(stateOf(post(page, 'Second ask'))).toHaveText('Queued');

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
  await cancelRequest(post(page, 'First word0'), 'api');
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
    /^@docs joined · Claude Fake Fast/,
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

test('a paired phone renames and pauses but cannot create, delete or change the chats', async ({
  page,
}) => {
  await asPairedPhone(page);
  await seeded(page);
  await expect(outpostRow(page, NAME)).toBeVisible();
  await expect(outpostsSection(page).getByRole('button', { name: 'New outpost' })).toHaveCount(0);
  await sidebar(page).getByRole('button', { name: 'Options for Docs site' }).click();
  const menu = page.getByRole('menu', { name: 'Options for Docs site' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Add to outpost' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const main = await openOutpost(page);
  await expect(main.getByRole('button', { name: 'Pause' })).toBeVisible();
  await main.getByRole('button', { name: NAME, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const dialog = sheet(page, 'Edit outpost');
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Add a chat' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Hold to delete outpost' })).toHaveCount(0);
  await expect(dialog).toContainText('Chats and handles are changed on your Mac.');
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Orders relaunch');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(outpostPage(page, 'Orders relaunch')).toBeVisible();
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

test('two chats with the same blob colour look different in their outpost, not in the sidebar', async ({
  page,
}) => {
  const [web, mobile] = await seedChats([
    { id: '0c000000-0000-4000-8000-000000000001', title: 'Web client' },
    { id: '0c000000-0000-4000-8000-000000000009', title: 'Mobile client' },
  ]);
  await openChats(page);
  const created = await page.request.post('/api/outposts', {
    data: {
      id: '0a000000-0000-4000-8000-000000000001',
      name: NAME,
      members: [
        { conversationId: web, handle: 'web' },
        { conversationId: mobile, handle: 'mobile' },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  await openChats(page);
  await openOutpost(page);

  const rowFace = (title: string) =>
    sidebar(page).locator('.row').filter({ hasText: title }).locator('.chat-face');
  await expect(rowFace('Web client')).toHaveAttribute('data-color', 'gold');
  await expect(rowFace('Mobile client')).toHaveAttribute('data-color', 'gold');
  await expect(chip(page, 'web').locator('.chat-face')).toHaveAttribute('data-color', 'gold');
  await expect(chip(page, 'mobile').locator('.chat-face')).toHaveAttribute('data-color', 'ember');
  await expect(thread(page).locator('.op-notice .chat-face')).toHaveCount(2);
  await expect(thread(page).locator('.op-notice .chat-face').nth(1)).toHaveAttribute(
    'data-color',
    'ember',
  );
});
