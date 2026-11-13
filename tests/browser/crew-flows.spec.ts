import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addSpark, fakeWorkflowApi, PANEL_PATH, step } from './crew-flows-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { PACKAGED } from './stub-config.ts';

const SHOTS = 'test-results/crew-flows';

test.skip(
  PACKAGED || Boolean(process.env.SPARK_WEB_BUILD),
  'the Workflows panel is mounted only by the dev-server preview page until the Sparks page exists',
);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const editor = (page: Page, name: string) => page.getByRole('region', { name: `Workflow ${name}` });
const stage = (page: Page, number: number) => page.getByRole('region', { name: `Stage ${number}` });
const stepRow = (page: Page, id: string) => page.locator(`[data-step="${id}"]`);
const graphNodes = (page: Page) => page.locator('.wf-graph .wf-node');

async function crew(page: Page) {
  return {
    security: await addSpark(page, 'Security', 'Finds risky changes'),
    lint: await addSpark(page, 'Lint', 'Style and unused code'),
    comment: await addSpark(page, 'Comment', 'Writes review comments'),
    ticketing: await addSpark(page, 'Ticketing', 'Updates the ticket'),
  };
}

async function pickSpark(page: Page, picker: string, spark: string) {
  await page.getByRole('button', { name: picker, exact: true }).click();
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: new RegExp(`^${spark}`) })
    .click();
}

async function shots(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).include('.wf-panel').analyze();
  expect(results.violations).toEqual([]);
}

test('an empty Workflows tab suggests workflows from the crew and a new one saves', async ({
  page,
}) => {
  const api = await fakeWorkflowApi(page, Object.values(await crew(page)));
  await page.goto(PANEL_PATH);

  await expect(
    page.getByRole('heading', { name: 'Combine your crew into a workflow' }),
  ).toBeVisible();
  const suggestions = page.getByRole('list', { name: 'Suggested workflows' });
  await expect(suggestions.getByRole('listitem')).toHaveCount(3);
  await expect(suggestions.getByRole('img').first()).toHaveAccessibleName(
    'Security, Lint, Comment and Ticketing',
  );
  await expect(suggestions.getByRole('img').nth(2)).toHaveAccessibleName(
    'Security, Lint and Comment, then Ticketing',
  );
  await expectAccessible(page);
  await shots(page, 'empty');

  await page.getByRole('button', { name: 'New workflow' }).click();
  const form = page.getByRole('form', { name: 'New workflow' });
  await expect(form.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await form.getByRole('button', { name: 'Open in editor' }).click();
  await expect(form.getByRole('alert')).toHaveText('Give the workflow a name.');
  await form.getByRole('textbox', { name: 'Name' }).fill('Pre-PR review');
  await expect(form.getByRole('radio', { name: 'Blank' })).toBeChecked();
  await expectAccessible(page);
  await shots(page, 'new');
  await form.getByRole('button', { name: 'Open in editor' }).click();

  const open = editor(page, 'Pre-PR review');
  await expect(open.getByText('Add a Spark to start.')).toBeVisible();
  await expect(open.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(open.getByRole('button', { name: 'Preview' })).toBeDisabled();

  await pickSpark(page, 'Add the first Spark', 'Security');
  await pickSpark(page, 'Add a Spark to Stage 1', 'Lint');
  await pickSpark(page, 'Add a stage', 'Comment');
  await pickSpark(page, 'Add a stage', 'Ticketing');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  await expect(stage(page, 1)).toContainText('2 at the same time');
  await expect(stepRow(page, 'comment')).toContainText('After all of Stage 1');
  await expect(stepRow(page, 'ticketing')).toContainText('After Comment');
  await expect(graphNodes(page)).toHaveCount(4);
  await expect(open.getByRole('figure', { name: /^Graph of the workflow/ })).toHaveAccessibleName(
    'Graph of the workflow: 4 steps in 3 stages',
  );
  await expectAccessible(page);
  await shots(page, 'editor');

  await open.getByRole('button', { name: 'Save' }).click();
  await expect(open.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect(api.saves).toEqual([{ id: 'pre-pr-review', baseHash: null }]);
  expect(api.files.get('pre-pr-review')?.workflow.steps.map((saved) => saved.dependsOn)).toEqual([
    [],
    [],
    ['security', 'lint'],
    ['comment'],
  ]);

  await open.getByRole('button', { name: 'Run' }).click();
  const run = page.getByRole('region', { name: 'Run of Pre-PR review' });
  await expect(run.getByRole('list', { name: 'All steps' }).getByRole('listitem')).toHaveCount(4);
  expect(api.runs).toEqual(['pre-pr-review']);
  await run.getByRole('button', { name: 'Back to the workflow' }).click();

  await open.getByRole('button', { name: 'Workflows' }).click();
  const rows = page.getByRole('list', { name: 'Workflows' });
  await expect(rows.getByRole('listitem')).toHaveCount(1);
  await expect(rows).toContainText('4 steps · 3 stages');
  await expect(rows.getByRole('img')).toHaveAccessibleName(
    'Security and Lint, then Comment, then Ticketing',
  );
  await expectAccessible(page);
  await shots(page, 'list');
});

test('a suggestion opens in the editor as a draft that nothing has saved', async ({ page }) => {
  const api = await fakeWorkflowApi(page, Object.values(await crew(page)));
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'Use Then Ticketing wraps up' }).click();
  const open = editor(page, 'Then Ticketing wraps up');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(3);
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);
  await expect(open.getByRole('button', { name: 'Save' })).toBeEnabled();
  await expect(open.getByRole('button', { name: 'Run' })).toBeDisabled();
  expect(api.saves).toEqual([]);

  await open.getByRole('button', { name: 'Workflows' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
  await expect(leave.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await leave.getByRole('button', { name: 'Discard changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Combine your crew into a workflow' }),
  ).toBeVisible();
});

test('editing shows a loop inline, blocks Save until it is fixed and saves with the hash it opened', async ({
  page,
}) => {
  const sparks = await crew(page);
  const api = await fakeWorkflowApi(page, Object.values(sparks));
  api.put({
    id: 'review',
    name: 'Review',
    steps: [
      step('security', sparks.security),
      step('lint', sparks.lint),
      step('comment', sparks.comment, ['security', 'lint']),
    ],
  });
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'Edit Review' }).click();
  const open = editor(page, 'Review');
  const save = open.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  await stepRow(page, 'security').getByRole('button', { name: 'Details for Security' }).click();
  await stepRow(page, 'security').getByRole('checkbox', { name: 'Comment' }).check();
  await expect(stepRow(page, 'security')).toContainText(
    'These steps wait on each other: security → comment → security.',
  );
  await expect(open.getByText('Fix 1 problem to save.')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(open.getByRole('button', { name: 'Preview' })).toBeDisabled();
  await expect(graphNodes(page)).toHaveCount(3);
  await shots(page, 'editor-problem');

  await stepRow(page, 'security').getByRole('checkbox', { name: 'Comment' }).uncheck();
  await expect(open.getByText('Fix 1 problem to save.')).toHaveCount(0);

  await stepRow(page, 'lint').getByRole('button', { name: 'Move Lint to a later stage' }).click();
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(2);
  await expect(stepRow(page, 'lint')).toContainText('After Security');
  await stepRow(page, 'comment').getByRole('button', { name: 'Details for Comment' }).click();
  await stepRow(page, 'comment').getByRole('checkbox', { name: 'Lint' }).check();
  await expect(stage(page, 3).getByRole('listitem')).toHaveCount(1);
  await expect(stepRow(page, 'comment')).toContainText('After Security and Lint');
  await stepRow(page, 'comment').getByRole('radio', { name: 'Any finishes' }).click();
  await expect(stepRow(page, 'comment')).toContainText('After any of Security and Lint');
  await stepRow(page, 'comment').getByRole('radio', { name: 'Continue' }).click();
  await stepRow(page, 'comment').getByRole('textbox', { name: 'Extra prompt' }).fill('Be brief.');

  await save.click();
  await expect(open.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect(api.saves).toEqual([{ id: 'review', baseHash: 'hash-1' }]);
  expect(api.files.get('review')?.workflow.steps[2]).toEqual({
    id: 'comment',
    sparkId: sparks.comment,
    prompt: 'Be brief.',
    dependsOn: ['security', 'lint'],
    join: 'any',
    onFailure: 'continue',
  });

  await stepRow(page, 'lint').getByRole('button', { name: 'Remove Lint' }).click();
  await expect(stepRow(page, 'lint')).toHaveCount(0);
  await save.click();
  await expect(open.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect(api.saves.at(-1)).toEqual({ id: 'review', baseHash: 'hash-2' });
});

test('a deleted Spark and a stale save are reported, and a workflow can be deleted', async ({
  page,
}) => {
  const sparks = await crew(page);
  const api = await fakeWorkflowApi(page, Object.values(sparks));
  api.put({
    id: 'review',
    name: 'Review',
    steps: [step('security', sparks.security), step('gone', crypto.randomUUID(), ['security'])],
  });
  await page.goto(PANEL_PATH);
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  await expect(row).toContainText('1 problem');
  await expect(row.getByRole('button', { name: 'Run Review' })).toBeDisabled();

  await row.getByRole('button', { name: 'Edit Review' }).click();
  const open = editor(page, 'Review');
  await expect(stepRow(page, 'gone')).toContainText('gone uses a Spark that no longer exists.');
  await expect(stepRow(page, 'gone')).toContainText('Missing Spark');
  await stepRow(page, 'gone').getByRole('button', { name: 'Details for Missing Spark' }).click();
  await pickSpark(page, 'Spark for Missing Spark', 'Lint');
  await expect(stepRow(page, 'gone')).toContainText('Lint');
  await expect(open.getByRole('button', { name: 'Save' })).toBeEnabled();

  api.put({ ...api.files.get('review')!.workflow, name: 'Changed elsewhere' });
  await open.getByRole('button', { name: 'Save' }).click();
  await expect(open.getByRole('alert')).toContainText('This workflow changed somewhere else.');
  expect(api.files.get('review')?.workflow.name).toBe('Changed elsewhere');

  const hold = open.getByRole('button', { name: 'Hold to delete Review' });
  await hold.scrollIntoViewIfNeeded();
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_700);
  await page.mouse.up();
  await expect(
    page.getByRole('heading', { name: 'Combine your crew into a workflow' }),
  ).toBeVisible();
  expect(api.files.size).toBe(0);
});

test('Preview plays the order and a pretend failure says what stops and what does not start', async ({
  page,
}) => {
  const sparks = await crew(page);
  const api = await fakeWorkflowApi(page, Object.values(sparks));
  api.put({
    id: 'review',
    name: 'Review',
    steps: [
      step('security', sparks.security),
      step('lint', sparks.lint),
      step('comment', sparks.comment, ['security', 'lint']),
      step('ticketing', sparks.ticketing, ['comment']),
    ],
  });
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'Edit Review' }).click();
  const open = editor(page, 'Review');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  calls.length = 0;
  await open.getByRole('button', { name: 'Preview' }).click();

  const steps = open.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  const result = open.locator('.wf-result');
  const position = open.locator('.wf-position');
  await expect(position).toHaveText('Round 3 of 3');
  await expect(result).toContainText('Every step runs.');
  await expect(result).toContainText('4 steps in 3 rounds.');
  await expect(steps).toContainText(['Done', 'Done', 'Done', 'Done']);

  const back = open.getByRole('button', { name: 'Step back' });
  const forward = open.getByRole('button', { name: 'Step forward' });
  await back.click();
  await expect(position).toHaveText('Round 2 of 3');
  await expect(steps).toContainText(['Done', 'Done', 'Done', 'Waiting']);
  await back.click();
  await back.click();
  await expect(position).toHaveText('Before the start · 3 rounds');
  await expect(back).toBeDisabled();
  await expect(steps).toContainText(['Waiting', 'Waiting', 'Waiting', 'Waiting']);
  await forward.click();
  await expect(steps).toContainText(['Done', 'Done', 'Waiting', 'Waiting']);
  await open.getByRole('button', { name: 'Play' }).click();
  await expect(open.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(position).toHaveText('Round 3 of 3');
  await expect(open.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(forward).toBeDisabled();

  await open.getByRole('checkbox', { name: 'Pretend Lint fails' }).check();
  await expect(position).toHaveText('Round 1 of 1');
  await expect(steps).toContainText(['Done', 'Failed', 'Skipped', 'Skipped']);
  await expect(result).toContainText('The workflow stops at round 1.');
  await expect(result).toContainText('Lint is set to Stop workflow when it fails.');
  await expect(result).toContainText("Comment and Ticketing don't start.");
  await expect(result).toContainText('Security still finishes and keeps its output.');
  await expect(graphNodes(page).filter({ hasText: 'Skipped' })).toHaveCount(2);
  await expectAccessible(page);
  await shots(page, 'preview-failure');

  await open.getByRole('button', { name: 'Change Lint to Continue' }).click();
  await expect(result).toContainText('The workflow keeps going.');
  await expect(steps).toContainText(['Done', 'Failed', 'Done', 'Done']);
  expect(calls).toEqual([]);

  await open.getByRole('button', { name: 'Back to editing' }).click();
  await stepRow(page, 'lint').getByRole('button', { name: 'Details for Lint' }).click();
  await expect(stepRow(page, 'lint').getByRole('radio', { name: 'Continue' })).toBeChecked();
  await expect(open.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test('a workflow is created, rearranged, previewed and saved with the keyboard alone', async ({
  page,
}) => {
  const api = await fakeWorkflowApi(page, Object.values(await crew(page)));
  await page.goto(PANEL_PATH);
  const newButton = page.getByRole('button', { name: 'New workflow' });
  await expect(newButton).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(newButton).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Keys only');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Blank' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Side by side' })).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: 'Blank' })).toBeChecked();
  for (const stop of ['Side by side', 'One after another', 'Then Ticketing wraps up']) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: stop })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Open in editor' })).toBeFocused();
  await page.keyboard.press('Enter');

  const open = editor(page, 'Keys only');
  await expect(open).toBeVisible();
  const first = open.getByRole('button', { name: 'Add the first Spark' });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: /^Security/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const securityDetails = stepRow(page, 'security').getByRole('button', {
    name: 'Details for Security',
  });
  await expect(securityDetails).toBeFocused();

  await open.getByRole('button', { name: 'Add a stage' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /^Lint/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    stepRow(page, 'lint').getByRole('button', { name: 'Details for Lint' }),
  ).toBeFocused();
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);

  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  const earlier = stepRow(page, 'lint').getByRole('button', {
    name: 'Move Lint to an earlier stage',
  });
  await expect(earlier).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  await expect(
    stepRow(page, 'lint').getByRole('button', { name: 'Move Lint to a later stage' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);
  await expect(earlier).toBeFocused();

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(
    stepRow(page, 'lint').getByRole('button', { name: 'Details for Lint' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  const after = stepRow(page, 'lint').getByRole('checkbox', { name: 'Security' });
  await expect(after).toBeChecked();
  await after.focus();
  await page.keyboard.press('Space');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  await expect(after).toBeFocused();
  await page.keyboard.press('Space');
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);
  await expect(after).toBeFocused();

  const fails = stepRow(page, 'lint').getByRole('radio', { name: 'Stop workflow' });
  await fails.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stepRow(page, 'lint').getByRole('radio', { name: 'Continue' })).toBeChecked();

  await open.getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  await open.getByRole('checkbox', { name: 'Pretend Security fails' }).focus();
  await page.keyboard.press('Space');
  await expect(open.locator('.wf-result')).toContainText("Lint doesn't start.");
  await open.getByRole('button', { name: 'Back to editing' }).focus();
  await page.keyboard.press('Enter');

  await open.getByRole('button', { name: 'Save' }).focus();
  await page.keyboard.press('Enter');
  await expect(open.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect(api.files.get('keys-only')?.workflow.steps).toMatchObject([
    { id: 'security', dependsOn: [] },
    { id: 'lint', dependsOn: ['security'], onFailure: 'continue' },
  ]);
});
