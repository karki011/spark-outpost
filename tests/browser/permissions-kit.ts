import { expect, type Page } from '@playwright/test';

export type Level = 'Ask before edits' | 'Auto-edit' | 'Full auto';

export type Permission = 'Ask' | Level;

interface Access {
  mode: string;
  autonomy: string | null;
}

const ACCESS: Record<'claude' | 'codex', Record<Permission, Access>> = {
  claude: {
    Ask: { mode: 'Plan', autonomy: null },
    'Ask before edits': { mode: 'Manual', autonomy: 'Automatic' },
    'Auto-edit': { mode: 'Accept edits', autonomy: 'Automatic' },
    'Full auto': { mode: 'Bypass permissions', autonomy: 'Full auto → PR' },
  },
  codex: {
    Ask: { mode: 'Read-only', autonomy: null },
    'Ask before edits': { mode: 'Ask every time', autonomy: 'Automatic' },
    'Auto-edit': { mode: 'Approve for me', autonomy: 'Automatic' },
    'Full auto': { mode: 'Approve for me', autonomy: 'Full auto → PR' },
  },
};

export const pickerPanel = (page: Page) =>
  page.getByRole('dialog', { name: 'Model, effort, and permissions' });

export async function pickMode(page: Page, mode: string): Promise<void> {
  const modes = pickerPanel(page).getByRole('radiogroup', { name: 'Agent mode' });
  await modes.getByRole('radio', { name: mode, exact: true }).click();
  await expect(modes.getByRole('radio', { name: mode, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

export const permissionChip = (page: Page) => page.getByRole('button', { name: /^Permissions: / });

export const autonomyChip = (page: Page) => page.getByRole('button', { name: /^Spark autonomy: / });

export const workPanel = (page: Page) => page.locator('#work-panel');

export async function pickAutonomy(page: Page, autonomy: string): Promise<void> {
  if (await pickerPanel(page).isVisible()) await page.keyboard.press('Escape');
  await expect(pickerPanel(page)).toBeHidden();
  const current = await autonomyChip(page).getAttribute('aria-label');
  if (current === `Spark autonomy: ${autonomy}`) return;
  const panel = workPanel(page);
  const wasOpen = await panel.evaluate((element) => element.classList.contains('on'));
  await autonomyChip(page).click();
  const levels = panel.getByRole('radiogroup', { name: 'Spark autonomy' });
  const choice = levels.getByRole('radio', { name: autonomy, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await expect(autonomyChip(page)).toHaveAccessibleName(`Spark autonomy: ${autonomy}`);
  if (!wasOpen) {
    await panel.getByRole('button', { name: 'Hide work panel' }).click();
    await expect(panel).not.toHaveClass(/\bon\b/);
  }
}

export async function pickPermission(
  page: Page,
  permission: Permission,
  provider: 'claude' | 'codex' = 'claude',
): Promise<void> {
  const { mode, autonomy } = ACCESS[provider][permission];
  if (autonomy) {
    await pickAutonomy(page, autonomy);
    await page.getByRole('button', { name: /^Model and effort/ }).click();
  }
  const panel = pickerPanel(page);
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await pickMode(page, mode);
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText(mode);
}
