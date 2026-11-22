import { expect, type Locator, type Page } from '@playwright/test';
import { addSpark } from './crew-flows-kit.ts';

export const editor = (page: Page, name: string) =>
  page.getByRole('region', { name: `Workflow ${name}` });
export const stage = (page: Page, number: number) =>
  page.getByRole('region', { name: `Stage ${number}` });
export const stepRow = (page: Page, id: string) => page.locator(`[data-step="${id}"]`);
export const graphNodes = (page: Page) => page.locator('.wf-graph .wf-node');
export const inspector = (page: Page, label: string) =>
  page.getByRole('complementary', { name: `Step ${label}` });
export const saveButton = (page: Page, name: string) =>
  editor(page, name).getByRole('button', { name: 'Save', exact: true });

export async function selectStep(page: Page, id: string, label: string) {
  await stepRow(page, id)
    .getByRole('button', { name: `Edit ${label}` })
    .click();
  return inspector(page, label);
}

export async function runNow(page: Page, name: string, item = 'Run now') {
  await editor(page, name).getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('menu', { name: 'Run' }).getByRole('menuitem', { name: item }).click();
}

export async function crew(page: Page) {
  return {
    security: await addSpark(page, 'Security', 'Finds risky changes'),
    lint: await addSpark(page, 'Lint', 'Style and unused code'),
    comment: await addSpark(page, 'Comment', 'Writes review comments'),
    ticketing: await addSpark(page, 'Ticketing', 'Updates the ticket'),
  };
}

export async function pickSpark(page: Page, picker: string, spark: string) {
  await page.getByRole('button', { name: picker, exact: true }).click();
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: new RegExp(`^${spark}`) })
    .click();
}

export async function tabTo(page: Page, target: Locator, key = 'Tab') {
  for (let presses = 0; presses < 30; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}
