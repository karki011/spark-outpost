import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  crew,
  editor,
  graphNodes,
  inspector,
  pickSpark,
  runNow,
  saveButton,
  selectStep,
  stage,
  stepRow,
} from './crew-editor-kit.ts';
import { fakeWorkflowApi, PANEL_PATH, step } from './crew-flows-kit.ts';
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
  await expect(open.getByText('Add a step to start.')).toBeVisible();
  await expect(saveButton(page, 'Pre-PR review')).toBeDisabled();
  await expect(open.getByRole('button', { name: 'Preview' })).toBeDisabled();
  await expect(open.getByRole('tab')).toHaveText([/^Steps/, /^When it runs/, /^Runs/]);

  await pickSpark(page, 'Add the first step', 'Security');
  await pickSpark(page, 'Add a step to Stage 1', 'Lint');
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

  await expect(open.getByRole('status').filter({ hasText: '1 unsaved change' })).toBeVisible();
  await saveButton(page, 'Pre-PR review').click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.saves).toEqual([{ id: 'pre-pr-review', baseHash: null }]);
  expect(api.log).toEqual(['workflow']);
  expect(api.files.get('pre-pr-review')?.workflow.steps.map((saved) => saved.dependsOn)).toEqual([
    [],
    [],
    ['security', 'lint'],
    ['comment'],
  ]);

  await runNow(page, 'Pre-PR review');
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
  await expect(saveButton(page, 'Then Ticketing wraps up')).toBeEnabled();
  await expect(open.getByRole('button', { name: 'Save and test run' })).toBeEnabled();
  await open.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Run' }).getByRole('menuitem')).toHaveText([
    'Save and run now',
    'Save and run with a message and project…',
    'Save and run in chats…',
  ]);
  await page.keyboard.press('Escape');
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
  const save = saveButton(page, 'Review');
  await expect(save).toBeDisabled();

  const security = await selectStep(page, 'security', 'Security');
  await security.getByRole('checkbox', { name: 'Comment' }).check();
  await expect(security).toContainText(
    'These steps wait on each other: security → comment → security.',
  );
  await expect(stepRow(page, 'security')).toContainText('Problem');
  await expect(open.getByText('Fix 1 problem to save.')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(open.getByRole('button', { name: 'Preview' })).toBeDisabled();
  await expect(graphNodes(page)).toHaveCount(3);
  await shots(page, 'editor-problem');

  await security.getByRole('checkbox', { name: 'Comment' }).uncheck();
  await expect(open.getByText('Fix 1 problem to save.')).toHaveCount(0);

  await graphNodes(page).getByRole('button', { name: 'Edit Lint' }).click();
  const lint = inspector(page, 'Lint');
  await expect(stepRow(page, 'lint').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await lint.getByRole('button', { name: 'Move Lint to a later stage' }).click();
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(2);
  await expect(stepRow(page, 'lint')).toContainText('After Security');
  await expect(lint.getByRole('status')).toContainText('Lint: After Security · was Starts first');
  await expect(lint.getByRole('status')).toContainText(
    'Comment: After Security · was After all of Stage 1',
  );
  const comment = await selectStep(page, 'comment', 'Comment');
  await comment.getByRole('checkbox', { name: 'Lint' }).check();
  await expect(stage(page, 3).getByRole('listitem')).toHaveCount(1);
  await expect(stepRow(page, 'comment')).toContainText('After Security and Lint');
  await comment.getByRole('radio', { name: 'Any finishes' }).click();
  await expect(stepRow(page, 'comment')).toContainText('After any of Security and Lint');
  await comment.getByRole('radio', { name: 'Continue' }).click();
  await comment.getByRole('textbox', { name: 'Extra prompt' }).fill('Be brief.');
  await expect(open.getByRole('status').filter({ hasText: '2 unsaved changes' })).toBeVisible();

  await save.click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.saves).toEqual([{ id: 'review', baseHash: 'hash-1' }]);
  expect(api.files.get('review')?.workflow.steps[2]).toEqual({
    id: 'comment',
    sparkId: sparks.comment,
    prompt: 'Be brief.',
    dependsOn: ['security', 'lint'],
    join: 'any',
    onFailure: 'continue',
  });

  await (
    await selectStep(page, 'lint', 'Lint')
  )
    .getByRole('button', { name: 'Remove Lint' })
    .click();
  await expect(stepRow(page, 'lint')).toHaveCount(0);
  await save.click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
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
  await expect(stepRow(page, 'gone')).toContainText('Missing Spark');
  await expect(stepRow(page, 'gone')).toContainText('Problem');
  const gone = await selectStep(page, 'gone', 'Missing Spark');
  await expect(gone).toContainText('gone uses a Spark that no longer exists.');
  await pickSpark(page, 'Spark or workflow for Missing Spark', 'Lint');
  await expect(stepRow(page, 'gone')).toContainText('Lint');
  await expect(saveButton(page, 'Review')).toBeEnabled();

  api.put({ ...api.files.get('review')!.workflow, name: 'Changed elsewhere' });
  await saveButton(page, 'Review').click();
  await expect(open.getByRole('alert')).toContainText(
    'The steps didn’t save: This workflow changed somewhere else.',
  );
  await expect(open.getByRole('status').filter({ hasText: '1 unsaved change' })).toBeVisible();
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

test('a workflow is added as a step of another and Preview shows the steps inside it', async ({
  page,
}) => {
  const sparks = await crew(page);
  const api = await fakeWorkflowApi(page, Object.values(sparks));
  api.put({
    id: 'review',
    name: 'Review',
    steps: [step('security', sparks.security), step('lint', sparks.lint, ['security'])],
  });
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'New workflow' }).click();
  const form = page.getByRole('form', { name: 'New workflow' });
  await form.getByRole('textbox', { name: 'Name' }).fill('Ship');
  await form.getByRole('button', { name: 'Open in editor' }).click();
  const open = editor(page, 'Ship');

  await pickSpark(page, 'Add the first step', 'Review');
  await pickSpark(page, 'Add a stage', 'Comment');
  await expect(stepRow(page, 'review')).toContainText('Review');
  await expect(stepRow(page, 'comment')).toContainText('After Review');
  const nested = await selectStep(page, 'review', 'Review');
  await expect(nested).toContainText('Continue applies to every step inside it.');
  await expect(graphNodes(page)).toHaveCount(2);
  await expectAccessible(page);
  await shots(page, 'nested');

  await open.getByRole('button', { name: 'Preview' }).click();
  const steps = open.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toContainText(['Review › Security', 'Review › Lint', 'Comment']);
  await expect(open.locator('.wf-result')).toContainText('3 steps in 3 rounds.');
  await steps.nth(1).getByRole('checkbox', { name: 'Pretend Review › Lint fails' }).check();
  await expect(open.locator('.wf-result')).toContainText(
    'Review › Lint is set to Stop workflow when it fails.',
  );
  await open.getByRole('button', { name: 'Back to editing' }).click();

  await saveButton(page, 'Ship').click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.files.get('ship')?.workflow.steps).toMatchObject([
    { id: 'review', workflowId: 'review', dependsOn: [] },
    { id: 'comment', sparkId: sparks.comment, dependsOn: ['review'] },
  ]);

  await open.getByRole('button', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: 'Edit Review' }).click();
  const used = editor(page, 'Review');
  await expect(used.getByRole('button', { name: 'Hold to delete Review' })).toBeDisabled();
  await expect(used).toContainText(
    'Used in Ship. Remove that step there before deleting this workflow.',
  );
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
  const lint = await selectStep(page, 'lint', 'Lint');
  await expect(lint.getByRole('radio', { name: 'Continue' })).toBeChecked();
  await expect(saveButton(page, 'Review')).toBeEnabled();
});

test('a wide parallel stage stays on one line in the list with a count of the rest', async ({
  page,
}) => {
  const sparks = await crew(page);
  const api = await fakeWorkflowApi(page, Object.values(sparks));
  const ids = Object.values(sparks);
  const middle = Array.from({ length: 7 }, (_, index) =>
    step(`check${index}`, ids[index % ids.length]!, ['start']),
  );
  api.put({
    id: 'gauntlet',
    name: 'The Gauntlet',
    steps: [
      step('start', sparks.security),
      ...middle,
      step(
        'end',
        sparks.ticketing,
        middle.map((item) => item.id),
      ),
    ],
  });
  await page.goto(PANEL_PATH);
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  await expect(row).toContainText('9 steps · 3 stages');
  await expect(row.locator('.wf-mini-more')).toHaveText('+3');
  const box = await row.boundingBox();
  expect(box!.height).toBeLessThan(120);
  await shots(page, 'list-wide-stage');
});
