import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  NAME,
  POSTS_URL,
  asPairedPhone,
  asksLine,
  box,
  openOutpost,
  outpostPage,
  outpostRow,
  requestsTo,
  seeded,
  thread,
} from './outposts-kit.ts';
import {
  expectInsideViewport,
  expectNoSidewaysScroll,
  openTouch,
  PHONE,
} from './responsive-kit.ts';

const NOTE = [
  '**Ship blocker:** the Export button ignores _row-level_ access.',
  '',
  '- check `canExportAll()` first',
  '- add a test for ~~admins~~ team leads',
  '',
  '> from the CP-49259 review',
  '',
  '```ts',
  'expect(canExportAll(member)).toBe(false);',
  '```',
  '',
  'See [the ticket](https://acme.example/browse/CP-49259)',
].join('\n');

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

function postedTexts(page: Page): () => string[] {
  const posted = requestsTo(page, POSTS_URL, 'POST');
  return () => posted.map((request) => (request.postDataJSON() as { text: string }).text);
}

async function composerHeight(page: Page, input: Locator): Promise<number> {
  const composer = page.locator('.composer').filter({ has: input });
  return (await composer.boundingBox())?.height ?? 0;
}

test('a note is sent as typed and shows as Markdown in the outpost thread', async ({ page }) => {
  await seeded(page);
  await openOutpost(page);
  const texts = postedTexts(page);
  await box(page).fill(NOTE);
  await expect(page.locator('.op-composer .mdl-code')).toHaveText(
    'expect(canExportAll(member)).toBe(false);',
  );
  await box(page).press('ControlOrMeta+End');
  await box(page).press('Enter');
  await expect.poll(texts).toEqual([NOTE]);

  const note = thread(page).locator('.op-post').last();
  await expect(note.locator('strong')).toHaveText('Ship blocker:');
  await expect(note.locator('em')).toHaveText('row-level');
  await expect(note.locator('li')).toHaveCount(2);
  await expect(note.locator('del')).toHaveText('admins');
  await expect(note.locator('blockquote')).toContainText('from the CP-49259 review');
  await note.getByRole('button', { name: 'Show all of the note' }).click();
  await expect(note.locator('pre')).toContainText('expect(canExportAll(member)).toBe(false);');
  await expect(note.getByRole('link', { name: 'the ticket' })).toHaveAttribute(
    'href',
    'https://acme.example/browse/CP-49259',
  );
  await expect(note).not.toContainText('**');
});

test('the outpost box formats, keeps its handles and adds code lines on Enter', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  const texts = postedTexts(page);
  const input = box(page);
  await input.pressSequentially('@f');
  await input.press('Enter');
  await expect(input).toHaveValue('@fe ');
  await input.pressSequentially('please fix this');
  for (let index = 0; index < 4; index += 1) await input.press('Shift+ArrowLeft');
  await input.press('ControlOrMeta+b');
  await expect(input).toHaveValue('@fe please fix **this**');
  await expect(asksLine(page)).toContainText('@fe');
  await expect(page.locator('.op-composer .mdm-mention')).toHaveText('@fe');

  await input.press('End');
  await input.press('Shift+Enter');
  await input.pressSequentially('```');
  await input.press('Enter');
  await input.pressSequentially('npm test');
  await input.press('Enter');
  expect(texts()).toEqual([]);
  await input.pressSequentially('```');
  await expect(input).toHaveValue('@fe please fix **this**\n```\nnpm test\n```');

  await page.getByRole('button', { name: 'Formatting' }).click();
  await expect(input).toBeFocused();
  const bar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Bold' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Italic' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();

  await input.press('Enter');
  await expect.poll(texts).toEqual(['@fe please fix **this**\n```\nnpm test\n```']);
});

test('the Markdown box fits a paired phone and focus does not move the layout', async ({
  browser,
  page,
}) => {
  await seeded(page);
  const phone = await openTouch(browser, PHONE, 'chats', asPairedPhone);
  try {
    await phone.getByRole('button', { name: /^(Open|Show) sidebar/ }).click();
    await outpostRow(phone, NAME).click();
    await expect(outpostPage(phone, NAME)).toBeVisible();
    const input = box(phone);
    await input.fill('**bold** and `code` with a long token '.concat('y'.repeat(80)));
    await input.blur();
    const resting = await composerHeight(phone, input);
    await input.focus();
    expect(await composerHeight(phone, input)).toBe(resting);
    await expect(phone.getByRole('toolbar', { name: 'Format selection' })).toBeHidden();
    await phone.getByRole('button', { name: 'Formatting' }).click();
    const bar = phone.getByRole('toolbar', { name: 'Formatting' });
    await expectInsideViewport(phone, bar);
    await expectNoSidewaysScroll(phone);
    const sizes = await bar
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
  } finally {
    await phone.context().close();
  }
});
