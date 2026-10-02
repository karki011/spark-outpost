import { expect, type Page } from '@playwright/test';

export const CLAUDE_KEY = `sk-ant-api03-${'a'.repeat(24)}4f2a`;

export const dialog = (page: Page) => page.locator('.onb');
export const continueButton = (page: Page) =>
  dialog(page).getByRole('button', { name: 'Continue' });
export const nameField = (page: Page) =>
  dialog(page).getByLabel('What should Spark call you?', { exact: true });
export const tile = (page: Page, id: string) => dialog(page).locator(`.ptile[data-prov="${id}"]`);
export const screen = (page: Page, id: string) => dialog(page).locator(`.pconf[data-prov="${id}"]`);
export const claudeCard = (page: Page) => screen(page, 'claude');
export const section = (page: Page, id: string, name: string) =>
  screen(page, id).getByRole('region', { name });

export async function enterName(page: Page, name: string) {
  await page.goto('/');
  await expect(dialog(page).getByRole('heading', { name: 'Meet Spark' })).toBeVisible();
  await expect(continueButton(page)).toBeDisabled();
  await expect(dialog(page)).toContainText('Enter your name to continue.');
  await nameField(page).fill(name);
  await expect(dialog(page)).toContainText(`Hi ${name.split(' ')[0]} 👋`);
  await nameField(page).press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Pick a theme' })).toBeVisible();
  await continueButton(page).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Connect your AI providers' }),
  ).toBeVisible();
}

export async function openTile(page: Page, id: string) {
  await tile(page, id).click();
  await expect(screen(page, id)).toBeVisible();
}

export async function holdToConfirm(page: Page, name: string) {
  const hold = dialog(page).getByRole('button', { name });
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(page.locator('.toast.grace')).toBeVisible({ timeout: 5_000 });
  await page.keyboard.up(' ');
}

export async function openApiKeyTab(page: Page) {
  await openTile(page, 'claude');
  await claudeCard(page).getByRole('tab', { name: 'API key' }).click();
  await expect(
    claudeCard(page).getByRole('link', { name: 'Claude Console (opens in a new tab)' }),
  ).toHaveAttribute('href', 'https://platform.claude.com/settings/keys');
  return claudeCard(page).getByLabel('Claude API key');
}
