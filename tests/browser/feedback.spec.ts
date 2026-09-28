import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { card, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';
import { openChats } from './navigation.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const keepCard = (page: Page) =>
  page.getByRole('group', { name: 'Keep these changes?', exact: true });
const askHow = (page: Page) => page.getByRole('group', { name: 'How did it go?' });

async function keptChange(page: Page, choice: 'Keep' | 'Revert'): Promise<void> {
  await crewChat(page, repo, 'Review keep');
  await send(page, 'Fix the divider #build');
  await expect(keepCard(page)).toBeVisible({ timeout: 30_000 });
  await keepCard(page).getByRole('button', { name: choice, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });
}

test('asks how it went after Keep, and the answer can be changed later', async ({ page }) => {
  test.setTimeout(60_000);
  await keptChange(page, 'Keep');
  const feedback = keepCard(page).getByRole('group', { name: 'How did it go?' });
  await expect(feedback).toBeVisible({ timeout: 15_000 });
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

test('shows a quiet thumbs row under an answer', async ({ page }) => {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await send(page, 'What does the divider component do?');
  await expect(page.locator('.md', { hasText: 'You wrote' })).toBeVisible({ timeout: 15_000 });
  const feedback = askHow(page);
  await expect(feedback).toBeVisible({ timeout: 15_000 });
  await feedback.getByRole('button', { name: 'Bad result' }).click();
  await expect(feedback.getByRole('group', { name: 'Reasons' })).toBeVisible();
  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await feedback.getByRole('textbox', { name: 'Comment (optional)' }).fill('Too vague');
  await feedback.getByRole('button', { name: 'Save' }).click();
  await expect(feedback.getByRole('status')).toHaveText('Saved');
});

test('stays quiet when the signals agree: just the thumbs', async ({ page }) => {
  test.setTimeout(90_000);
  writeFileSync(path.join(repo.root, 'check.mjs'), "console.log('ok');\n");
  await crewChat(page, repo, 'Review keep');
  const listed = await page.request.get('/api/projects');
  const project = ((await listed.json()) as { id: string; rootPath: string }[]).find(
    (candidate) => candidate.rootPath === repo.root,
  );
  const saved = await page.request.patch(`/api/projects/${project!.id}`, {
    data: { checkCommands: [`${process.execPath} check.mjs`] },
  });
  expect(saved.ok()).toBe(true);
  await send(page, 'Fix the divider #build');
  const check = card(page, /^Run a check\?/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await check.getByRole('button', { name: 'Allow', exact: true }).click({ timeout: 30_000 });
  await expect(keepCard(page)).toBeVisible({ timeout: 30_000 });
  await keepCard(page).getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 30_000 });

  const good = keepCard(page).getByRole('button', { name: 'Good result' });
  await expect(good).toBeVisible({ timeout: 15_000 });
  await expect(keepCard(page).locator('.fb-q')).toHaveCount(0);
  await good.click();
  await expect(good).toHaveAttribute('aria-pressed', 'true');
});
