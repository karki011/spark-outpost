import { expect, type Page } from '@playwright/test';

export async function pickTerminalAgent(page: Page, name: 'Claude Code' | 'Codex') {
  await page.getByRole('button', { name: /^Terminal agent: / }).click();
  await page
    .getByRole('dialog', { name: 'Terminal agent and permissions' })
    .getByRole('tab', { name, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Terminal agent: ${name}` })).toBeVisible();
}
