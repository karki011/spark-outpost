import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  NAME,
  TURN_TIMEOUT,
  inBothThemes,
  openOutpost,
  outpostRow,
  post,
  say,
  seeded,
  stateOf,
} from './outposts-kit.ts';

const NOTES_PATH =
  '/private/tmp/claude-501/-Users-example-Documents-spark-outpost/a4615ee5-3825-46d0-81c0-2f27f5a5f811/scratchpad/real-outposts/api/NOTES.md';
const COMMENTARY = 'I will read the message before I answer.';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('an answer is drawn as Markdown and is the final reply, without the commentary', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(
    page,
    `@api #commentary Add the notes file.\n\nAdded \`NOTES.md\` at [NOTES.md](${NOTES_PATH}) and **stopped**.\n\nThanks`,
  );
  const request = post(page, '#commentary Add the notes file.');
  await expect(stateOf(request)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  const answer = request.locator('.op-reply');
  const text = answer.locator('.op-text');
  const toggle = answer.locator('button[aria-controls]');

  await inBothThemes(page, 'collapsed', async () => {
    await expect(text).toHaveText(/^This reply comes from the fake provider/);
    await expect(answer).not.toContainText(COMMENTARY);
    await expect(text).toHaveClass(/clamped/);
    await expect(toggle).toHaveText('Show all of the answer');
  });

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('Show less');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();

  await inBothThemes(page, 'markdown', async () => {
    await expect(text).not.toHaveClass(/clamped/);
    await expect(text.locator('code')).toHaveText('NOTES.md');
    await expect(text.locator('strong')).toHaveText('stopped');
    await expect(text.locator('.md-link-off')).toHaveText('NOTES.md');
    await expect(text).not.toContainText('/private/tmp');
    await expect(text).not.toContainText('`');
    await expect(text).not.toContainText('**');
    await expect(answer.getByRole('link')).toHaveCount(0);
    await expect(request.locator('.op-text').first()).toContainText('`NOTES.md`');
  });

  await request.getByRole('button', { name: 'Open @api in chat' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  await expect(page.locator('.thread')).toContainText(COMMENTARY);
  await expect(page.locator('.thread')).toContainText('This reply comes from the fake provider');
});

test('the question and the user’s answer stay under a request that needed you', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api Deploy the orders service\n\nNeeds you: which region?\n\nThanks');
  const request = post(page, 'Deploy the orders service');
  await expect(stateOf(request)).toHaveText('Needs you', { timeout: TURN_TIMEOUT });
  const waiting = request.locator('.op-reply');
  await expect(waiting).toContainText('is waiting for you');

  await inBothThemes(page, 'needs-you', async () => {
    await expect(request.locator('.op-reason')).toHaveText('which region?');
    await expect(waiting).toContainText('Deploy the orders service');
    await expect(waiting).not.toContainText('which region?');
  });

  await request.getByRole('button', { name: 'Answer', exact: true }).click();
  const answerBox = page.getByRole('combobox', { name: 'Answer @api' });
  await answerBox.fill('eu-west');
  await answerBox.press('Enter');
  await expect(stateOf(request)).toHaveText('Answered', { timeout: TURN_TIMEOUT });
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(NAME);
  const asked = request.locator('.op-asked');

  const kept = async () => {
    await expect(asked).toHaveCount(1);
    await expect(asked.locator('.op-post-head').first()).toHaveText(/@api\s*asked/);
    await expect(asked).toContainText('Deploy the orders service');
    await expect(asked.locator('.op-reason')).toHaveText('which region?');
    await expect(asked.locator('.op-post-head').nth(1)).toHaveText(/You\s*answered/);
    await expect(asked.locator('.op-text').last()).toHaveText('eu-west');
    await expect(request.locator('.op-reply')).toContainText('answered');
    await expect(request.locator('.op-reply')).toContainText('eu-west');
    await expect(request.locator('> .op-reason')).toHaveCount(0);
  };
  await inBothThemes(page, 'answered', kept);

  await openChats(page);
  await openOutpost(page);
  await kept();
});
