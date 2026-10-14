import { expect, type Locator, type Page } from '@playwright/test';
import { openChats } from './navigation.ts';

export const FIXTURE_READY = 'Ready for terminal input. No provider request is made.';

export async function startFixtureTerminal(
  page: Page,
  open: (page: Page) => Promise<void> = openChats,
): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page
    .getByRole('radiogroup', { name: 'Session type' })
    .getByRole('radio', { name: 'Terminal' })
    .click();
  await page.getByRole('button', { name: /^Terminal agent: / }).click();
  await page
    .getByRole('dialog', { name: 'Terminal agent and permissions' })
    .getByRole('tab', { name: 'Codex', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('textbox', { name: 'What would you like to work on?' })
    .fill('Inspect the fixture.');
  await page.getByRole('button', { name: 'Start terminal', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(workspace.locator('.xterm-accessibility')).toContainText(FIXTURE_READY);
  return workspace;
}

export async function typeLine(page: Page, workspace: Locator, line: string): Promise<void> {
  await workspace.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await expect(workspace.locator('.xterm-accessibility')).toContainText(`]: ${line}`);
}

export async function pointOf(
  workspace: Locator,
  text: string,
  offset = 2,
): Promise<{ x: number; y: number }> {
  const found = await workspace
    .locator('.xterm-accessibility-tree > div')
    .evaluateAll((rows, wanted) => {
      const index = rows.findIndex((row) => row.textContent?.includes(wanted));
      return [index, rows.length, index < 0 ? -1 : rows[index]!.textContent!.indexOf(wanted)];
    }, text);
  const [row, rows, column] = found as [number, number, number];
  expect(row).toBeGreaterThanOrEqual(0);
  const screen = (await workspace.locator('.xterm-screen').boundingBox())!;
  const cell = await workspace
    .locator('.xterm-helper-textarea')
    .evaluate((cursor) => parseFloat((cursor as HTMLElement).style.width));
  expect(cell).toBeGreaterThan(1);
  return {
    x: screen.x + (column + offset + 0.5) * cell,
    y: screen.y + ((row + 0.5) * screen.height) / rows,
  };
}
