import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  NAME,
  TURN_TIMEOUT,
  cardOf,
  inBothThemes,
  openOutpost,
  openThread,
  outpostRow,
  post,
  say,
  seeded,
  stateOf,
  threadPane,
} from './outposts-kit.ts';

const NOTES_PATH =
  '/private/tmp/claude-501/-Users-example-Documents-spark-outpost/a4615ee5-3825-46d0-81c0-2f27f5a5f811/scratchpad/real-outposts/api/NOTES.md';
const COMMENTARY = 'I will read the message before I answer.';

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('an answer is summed up on its card and drawn as Markdown in its thread, without the commentary', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(
    page,
    `@api #commentary Add the notes file.\n\nAdded \`NOTES.md\` at [NOTES.md](${NOTES_PATH}) and **stopped**.\n\nThanks`,
  );
  const request = post(page, '#commentary Add the notes file.');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  const summary = cardOf(request).locator('.op-card-meta');

  await inBothThemes(page, 'card', async () => {
    await expect(summary).toHaveText(/^This reply comes from the fake provider/);
    await expect(summary).not.toContainText(COMMENTARY);
    await expect(summary).not.toContainText('**');
    await expect(request.locator('.op-text').first()).toContainText('NOTES.md');
    await expect(request.locator('.op-text').first().locator('code')).toHaveText('NOTES.md');
  });

  await openThread(request, 'api');
  const pane = threadPane(page, 'api');
  await expect(pane.getByRole('button', { name: 'Back to Overview' })).toBeFocused();
  await expect(pane).toContainText('This reply comes from the fake provider');
  await expect(pane.locator('.md strong').filter({ hasText: 'stopped' }).first()).toBeVisible();
  await inBothThemes(page, 'thread', async () => {
    await expect(pane).toBeVisible();
  });

  await pane.getByRole('button', { name: 'Open @api in chat' }).click();
  await expect(page.locator('.chat-title')).toHaveText('Orders API');
  await expect(page.locator('.thread')).toContainText(COMMENTARY);
  await expect(page.locator('.thread')).toContainText('This reply comes from the fake provider');
});

test('a request that needed you shows its question on the card, and the answer in its thread', async ({
  page,
}) => {
  await seeded(page);
  await openOutpost(page);
  await say(page, '@api Deploy the orders service\n\nNeeds you: which region?\n\nThanks');
  const request = post(page, 'Deploy the orders service');
  await expect(stateOf(request)).toHaveText('Waiting on you', { timeout: TURN_TIMEOUT });

  await inBothThemes(page, 'needs-you', async () => {
    await expect(cardOf(request).locator('.op-card-meta')).toHaveText('which region?');
  });

  await request.getByRole('button', { name: 'Answer @api', exact: true }).click();
  const answerBox = page.getByRole('combobox', { name: 'Answer @api' });
  await answerBox.fill('eu-west');
  await answerBox.press('Enter');
  await expect(stateOf(request)).toHaveText('Idle', { timeout: TURN_TIMEOUT });
  await expect(outpostRow(page, NAME)).toHaveAccessibleName(NAME);

  await openThread(request, 'api');
  const pane = threadPane(page, 'api');
  await expect(pane).toContainText('which region?');
  await expect(pane).toContainText('eu-west');
  await inBothThemes(page, 'answered', async () => {
    await expect(pane).toBeVisible();
  });
});
