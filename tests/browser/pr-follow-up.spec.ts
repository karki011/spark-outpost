import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { decidedApproval, seedPrFollowUp, SEED_DOING } from './pr-follow-up-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function openSparkSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Pull requests' })
    .click();
  return page.getByRole('dialog', { name: 'Pull requests' });
}

const saved = (page: Page) =>
  page.waitForResponse((response) => response.url().endsWith('/api/profile') && response.ok());

async function profile(page: Page) {
  return (await (await page.request.get('/api/setup')).json()).profile;
}

test('Spark opens PRs ready for review by default and can open drafts instead', async ({
  page,
}) => {
  const dialog = await openSparkSettings(page);
  const openAs = dialog.getByRole('radiogroup', { name: 'Open pull requests as' });
  await expect(openAs.getByRole('radio', { name: 'Ready for review' })).toBeChecked();
  await expect(openAs).toHaveAccessibleDescription('Reviewers are asked right away.');
  await expect(
    dialog.getByRole('radiogroup', { name: 'When checks still fail in Full auto' }),
  ).toHaveCount(0);

  const draft = saved(page);
  await openAs.getByRole('radio', { name: 'Draft' }).click();
  await draft;
  await expect(openAs).toHaveAccessibleDescription(
    'PRs open as drafts; mark them ready on GitHub when you are.',
  );
  expect((await profile(page)).prReadyForReview).toBe(false);
});

test('PR follow-up is on by default and its options turn off with it', async ({ page }) => {
  const dialog = await openSparkSettings(page);
  const followUp = dialog.getByRole('switch', { name: 'Follow up on pull requests' });
  const checks = dialog.getByRole('switch', { name: 'Fix failing checks' });
  const reviews = dialog.getByRole('switch', { name: 'Handle review comments' });
  const replies = dialog.getByRole('switch', { name: 'Reply on GitHub threads' });
  for (const toggle of [followUp, checks, reviews, replies]) await expect(toggle).toBeChecked();

  const replyOff = saved(page);
  await replies.click();
  await replyOff;
  await expect(replies).not.toBeChecked();

  const off = saved(page);
  await followUp.click();
  await off;
  await expect(followUp).not.toBeChecked();
  await expect(checks).toBeDisabled();
  await expect(reviews).toBeDisabled();
  expect(await profile(page)).toMatchObject({
    prFollowUp: false,
    prFollowUpChecks: true,
    prFollowUpReplies: false,
  });
});

test('the review bots to act on are listed, checked and saved, and turn off with review handling', async ({
  page,
}) => {
  const dialog = await openSparkSettings(page);
  const input = dialog.getByRole('textbox', { name: 'Review bots to act on' });
  await expect(input).toHaveAccessibleDescription(
    'Enter the login as GitHub shows it, like coderabbitai[bot] or gitar-bot.',
  );
  await input.fill('not a login!');
  await input.press('Enter');
  await expect(input).toHaveAccessibleDescription('Enter a GitHub login, like coderabbitai[bot].');
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  const added = saved(page);
  await input.fill('CodeRabbitAI[bot]');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await added;
  const list = dialog.getByRole('list', { name: 'Review bots to act on' });
  await expect(list.getByRole('listitem')).toHaveText(['coderabbitai[bot]Remove']);
  await expect(input).toHaveValue('');

  const second = saved(page);
  await input.fill('gitar-bot');
  await input.press('Enter');
  await second;
  expect((await profile(page)).prFollowUpBots).toEqual(['coderabbitai[bot]', 'gitar-bot']);

  const removed = saved(page);
  await list.getByRole('button', { name: 'Remove coderabbitai[bot]' }).click();
  await removed;
  await expect(list.getByRole('listitem')).toHaveText(['gitar-botRemove']);

  await page.reload();
  const reopened = await openSparkSettings(page);
  await expect(
    reopened.getByRole('list', { name: 'Review bots to act on' }).getByRole('listitem'),
  ).toHaveText(['gitar-botRemove']);

  const reviewsOff = saved(page);
  await reopened.getByRole('switch', { name: 'Handle review comments' }).click();
  await reviewsOff;
  await expect(reopened.getByRole('textbox', { name: 'Review bots to act on' })).toHaveCount(0);
  await expect(reopened.getByRole('button', { name: 'Remove gitar-bot' })).toHaveCount(0);
});

test('the chat shows what Spark is doing with its PR and one card confirms the push and replies', async ({
  page,
}) => {
  const seeded = await seedPrFollowUp();
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Fix the cents parser');

  const pull = page.getByRole('group', { name: 'Pull request acme/widgets#7', exact: true });
  await expect(pull.getByRole('link', { name: '#7', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/pull/7',
  );
  await expect(pull).toContainText('Checks failing');
  await expect(pull).toContainText('2 new comments');
  await expect(pull).toContainText('Round 1');
  await expect(page.locator('header.chat-head')).not.toContainText('PR #7');
  await pull.getByRole('button', { name: 'Pull request acme/widgets#7 details' }).click();
  await expect(pull).toContainText(`Spark: ${SEED_DOING}`);
  await expect(pull.getByRole('link', { name: 'Review the card' })).toBeVisible();
  await pull.getByText('3 items gathered').click();
  const held = pull.getByRole('listitem').filter({ hasText: 'F3' });
  await expect(held).toContainText('mallory · no write access');
  await expect(held).toContainText('Not acted on');
  await page.keyboard.press('Escape');

  const row = page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('listitem')
    .filter({ hasText: 'Fix the cents parser' });
  await expect(row.locator('.row-open')).toHaveAttribute('title', /PR feedback/);

  const card = page.getByRole('group', { name: /Address PR feedback\?/ });
  await expect(card.getByRole('link', { name: 'acme/widgets#7' })).toBeVisible();
  const push = card.getByRole('checkbox', { name: /Push 1 changed file/ });
  const comment = card.getByRole('checkbox', { name: /F2 alice/ });
  await expect(push).toBeChecked();
  await expect(card).toContainText(
    'Reply: “Fixed in the new commit: Handled thousands separators.”',
  );
  await comment.uncheck();
  await card.getByRole('button', { name: 'Push and reply' }).click();

  await expect
    .poll(async () => decidedApproval(seeded.approvalId))
    .toMatchObject({ status: 'allowed', edits: { skip: [seeded.items.comment] } });
});
