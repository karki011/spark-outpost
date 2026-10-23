import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { pickMode } from './permissions-kit.ts';
import { card, chatRepo, type ChatRepo, linkedChat, send } from './project-chat-kit.ts';
import { resetTestDatabase } from './database.ts';

const SHOTS = path.join('test-results', 'auto-mode-prompts');

let repo: ChatRepo;

test.beforeEach(async () => {
  repo = chatRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => {
  repo.remove();
});

async function chatInMode(page: Page, mode: string) {
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await expect(panel.getByRole('radio', { name: /Fake Fast/ })).toBeVisible();
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await expect(
    panel
      .getByRole('radiogroup', { name: 'Agent mode' })
      .getByRole('radio', { name: 'Plan', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await pickMode(page, mode);
  await page.keyboard.press('Escape');
}

test('in Auto, runs what the mode allows and explains a sandbox request', async ({ page }) => {
  test.setTimeout(90_000);
  await chatInMode(page, 'Auto');
  await send(page, 'Run the tests and check the package #approve #sandbox');
  const asked = card(page, /^Run .+\?$/);
  await expect(asked.locator('pre')).toHaveText('npm view left-pad version', {
    timeout: 15_000,
  });
  await expect(card(page, /^Run .+\?$/)).toHaveCount(1);
  await asked.getByRole('button', { name: 'Details' }).click();
  await expect(asked.locator('.appr-det-body')).toContainText(
    "couldn't run this inside its sandbox, so it asks before running it without one",
  );
  await expect(asked).toContainText('The sandbox blocked network access');
  await expect(asked).not.toContainText("aren't sandboxed");
  mkdirSync(SHOTS, { recursive: true });
  await asked.screenshot({ path: path.join(SHOTS, 'sandbox-card.png') });
  await asked.getByRole('button', { name: 'Always allow' }).click();
  await page.getByRole('menuitem', { name: 'Always allow in this project' }).click();
  await expect(
    page.locator('.md', { hasText: 'Done. fake-run=allowed fake-sandbox=allowed' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('keeps the answer buttons in view for a long command', async ({ page }) => {
  test.setTimeout(90_000);
  await chatInMode(page, 'Manual');
  await send(page, 'Fix the broken notes with the script #longcommand');
  const asked = card(page, /^Run .+\?$/);
  const more = asked.getByRole('button', { name: 'Show all (42 lines)' });
  await expect(more).toBeVisible({ timeout: 15_000 });
  await asked.scrollIntoViewIfNeeded();
  await expect(asked.getByRole('button', { name: 'Allow', exact: true })).toBeInViewport();
  await expect(asked.getByRole('button', { name: 'Deny', exact: true })).toBeInViewport();
  mkdirSync(SHOTS, { recursive: true });
  await asked.screenshot({ path: path.join(SHOTS, 'long-command-card.png') });
  await more.click();
  await expect(asked.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(asked.locator('pre')).toContainText("print('line 40')");
  await asked.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.md', { hasText: 'Done. fake-long=allowed' })).toBeVisible({
    timeout: 15_000,
  });
});
