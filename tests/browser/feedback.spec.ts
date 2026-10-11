import { expect, test, type Page } from '@playwright/test';
import { chatRepo, type ChatRepo, projectChat, resetWithAgents, send } from './project-chat-kit.ts';
import { openChats } from './navigation.ts';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const keepCard = (page: Page) => page.locator('section.result');

async function ask(page: Page, text: string, turns: number): Promise<void> {
  await send(page, text);
  await expect(page.locator('.turn-foot')).toHaveCount(turns, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 60_000 });
}

async function twoEarlierTurns(page: Page): Promise<void> {
  await ask(page, 'What does the divider component do?', 1);
  await ask(page, 'Where is the header styled?', 2);
}

async function keptChange(page: Page, choice: 'Keep' | 'Revert'): Promise<void> {
  await projectChat(page, repo, 'Auto-edit');
  if (choice === 'Keep') await twoEarlierTurns(page);
  await send(page, 'Fix the divider #build');
  await expect(keepCard(page)).toHaveAccessibleName(/^Kept · /, { timeout: 60_000 });
  await expect(keepCard(page).getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
  if (choice === 'Revert') {
    await page.getByRole('button', { name: 'Revert to before this run' }).click();
    await page
      .getByRole('group', { name: 'Revert to before this run' })
      .getByRole('button', { name: 'Revert', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: /^Reverted/ })).toBeVisible();
  }
}

test('asks how it went after Keep, and the answer can be changed later', async ({ page }) => {
  test.setTimeout(240_000);
  await keptChange(page, 'Keep');
  const feedback = keepCard(page).getByRole('group', { name: 'How did it go?' });
  await expect(feedback).toBeVisible({ timeout: 15_000 });
  await expect(feedback.locator('.fb-q')).toHaveCount(0);
  const line = (await keepCard(page).locator('.result-line').boundingBox())!;
  const thumbs = (await feedback.boundingBox())!;
  expect(thumbs.y + thumbs.height).toBeLessThanOrEqual(line.y + line.height + 1);
  const good = feedback.getByRole('button', { name: 'Good result' });
  await good.focus();
  await page.keyboard.press('Enter');
  await expect(good).toHaveAttribute('aria-pressed', 'true');
  await expect(feedback.getByRole('status')).toHaveText('Saved');

  await page.reload();
  const again = keepCard(page).getByRole('group', { name: 'How did it go?' });
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await again.getByRole('button', { name: 'Bad result' }).click();
  await again.getByRole('button', { name: 'Broke something' }).click();
  await expect(again.getByRole('button', { name: 'Broke something' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('after Revert, asks what went wrong with reasons and a comment', async ({ page }) => {
  test.setTimeout(60_000);
  await keptChange(page, 'Revert');
  await expect(keepCard(page)).toHaveAccessibleName('Reverted');
  const wrong = keepCard(page).getByRole('group', { name: 'What went wrong?' });
  await expect(wrong).toBeVisible({ timeout: 15_000 });
  await expect(wrong.getByRole('button', { name: 'Good result' })).toHaveCount(0);
  for (const reason of ['Wrong approach', 'Broke something', 'Too much change', 'Other']) {
    await expect(wrong.getByRole('button', { name: reason })).toBeVisible();
  }
  await wrong.getByRole('button', { name: 'Too much change' }).click();
  await wrong.getByRole('textbox', { name: 'Comment (optional)' }).fill('Touched unrelated files');
  await wrong.getByRole('button', { name: 'Save' }).click();
  await expect(wrong.getByRole('status')).toHaveText('Saved');

  await page.reload();
  const saved = keepCard(page).getByRole('group', { name: 'What went wrong?' });
  await expect(saved.getByRole('button', { name: 'Too much change' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(saved.getByRole('textbox', { name: 'Comment (optional)' })).toHaveValue(
    'Touched unrelated files',
  );
});

test('keeps the thumbs in the token row, nudging only from the third turn', async ({ page }) => {
  test.setTimeout(90_000);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await twoEarlierTurns(page);
  await ask(page, 'What does the badge component do?', 3);
  const turns = page.locator('.turn-foot');
  await expect(turns.nth(0).locator('.fb')).toHaveClass(/quiet/, { timeout: 15_000 });
  await expect(turns.nth(1).locator('.fb')).toHaveClass(/quiet/);
  const feedback = turns.nth(2).getByRole('group', { name: 'How did it go?' });
  await expect(feedback).toBeVisible({ timeout: 15_000 });
  await expect(feedback).not.toHaveClass(/quiet/);
  await expect(page.locator('.fb-q')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(feedback).toHaveCSS('opacity', '1');

  const bad = feedback.getByRole('button', { name: 'Bad result' });
  const meta = (await turns.nth(2).locator('.run-meta').boundingBox())!;
  const thumb = (await bad.boundingBox())!;
  expect(Math.abs(meta.y + meta.height / 2 - (thumb.y + thumb.height / 2))).toBeLessThan(6);
  expect(thumb.x).toBeGreaterThan(meta.x + meta.width);

  await bad.click();
  await expect(feedback.getByRole('group', { name: 'Reasons' })).toBeVisible();
  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await feedback.getByRole('textbox', { name: 'Comment (optional)' }).fill('Too vague');
  await feedback.getByRole('button', { name: 'Save' }).click();
  await expect(feedback.getByRole('status')).toHaveText('Saved');
});
