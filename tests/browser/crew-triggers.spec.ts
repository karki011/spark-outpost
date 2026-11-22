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
  stage,
  stepRow,
  tabTo,
} from './crew-editor-kit.ts';
import { addSpark, fakeWorkflowApi, PANEL_PATH, step } from './crew-flows-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { PACKAGED } from './stub-config.ts';

const SHOTS = 'test-results/crew-triggers';
const CHAT = '00000000-0000-4000-8000-0000000000c1';

test.skip(
  PACKAGED || Boolean(process.env.SPARK_WEB_BUILD),
  'the workflow routes are faked on the dev-server preview page, like the Workflows panel spec',
);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });
const unsaved = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function savedWorkflow(page: Page) {
  const security = await addSpark(page, 'Security', 'Finds risky changes');
  const api = await fakeWorkflowApi(page, [security]);
  api.put({ id: 'review', name: 'Review', steps: [step('security', security)] });
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'Edit Review' }).click();
  return { api, open: editor(page, 'Review') };
}

test('a new workflow gets a trigger and a schedule before its first save, and one Save writes all three', async ({
  page,
}) => {
  const api = await fakeWorkflowApi(page, Object.values(await crew(page)));
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Risk review');
  await page.getByRole('button', { name: 'Open in editor' }).click();
  const open = editor(page, 'Risk review');
  await pickSpark(page, 'Add the first Spark', 'Security');

  await tab(page, /^When it runs/).click();
  const triggers = page.getByRole('group', { name: 'When something happens' });
  await triggers.getByRole('switch', { name: 'A pull request opens or updates' }).click();
  await triggers.getByRole('switch', { name: 'Before publish' }).click();
  await triggers.getByRole('checkbox', { name: /^Hold the publish/ }).check();
  await triggers.getByLabel('Wait').fill('2');
  const schedule = page.getByRole('group', { name: 'On a schedule' });
  await schedule.getByRole('switch', { name: 'Run on a schedule' }).click();
  await expect(tab(page, /^When it runs/)).toHaveText('When it runs 3');
  await expect(page.getByRole('group', { name: 'What these runs may do' })).toContainText(
    'Security',
  );

  await tab(page, /^Steps/).click();
  await expect(stepRow(page, 'security')).toBeVisible();
  await tab(page, /^Runs/).click();
  await expect(page.getByRole('tabpanel', { name: 'Runs' })).toContainText(
    'Save the workflow to run it.',
  );
  await tab(page, /^When it runs/).click();
  await expect(
    triggers.getByRole('switch', { name: 'A pull request opens or updates' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(triggers.getByLabel('Wait')).toHaveValue('2');
  await expect(schedule.getByRole('switch', { name: 'Run on a schedule' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(unsaved(page, '6 unsaved changes')).toBeVisible();
  await expect(open.locator('[data-chip]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include('.wf-panel').analyze();
  expect(results.violations).toEqual([]);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/when-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  await saveButton(page, 'Risk review').click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.log).toEqual(['workflow', 'schedule', 'triggers']);
  expect(api.saves).toEqual([{ id: 'risk-review', baseHash: null }]);
  expect(api.when.scheduleSaves).toHaveLength(1);
  expect(api.when.scheduleSaves[0]).toMatchObject({ enabled: true, every: 1, unit: 'days' });
  expect(api.when.triggerSaves).toEqual([
    expect.objectContaining({
      pullRequest: true,
      beforePublish: true,
      holdOnFindings: true,
      debounceMinutes: 2,
      commit: false,
    }),
  ]);
  await expect(open.locator('[data-chip="trigger"]')).toHaveText([
    'Pull request opens',
    'Before publish',
  ]);
  await expect(open.locator('[data-chip="schedule"]')).toContainText('Every day');

  await open.getByRole('button', { name: 'Workflows' }).click();
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  await expect(row.locator('[data-chip]')).toHaveCount(3);
});

test('one leave guard covers a trigger change, and a bad pattern or wait says what is wrong', async ({
  page,
}) => {
  const { api, open } = await savedWorkflow(page);
  await tab(page, /^When it runs/).click();
  const triggers = page.getByRole('group', { name: 'When something happens' });
  await triggers.getByRole('switch', { name: 'A new commit on the branch' }).click();
  await expect(triggers).toContainText('Every branch.');

  await open.getByRole('button', { name: 'Workflows' }).click();
  const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
  await expect(leave).toContainText('1 unsaved change');
  await expect(leave.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(
    triggers.getByRole('switch', { name: 'A new commit on the branch' }),
  ).toHaveAttribute('aria-checked', 'true');

  await triggers.getByLabel('Only on branches').fill('spark/*, feat..ure');
  await expect(triggers).toContainText('feat..ure can never match a branch.');
  await expect(triggers.getByLabel('Only on branches')).toHaveAttribute('aria-invalid', 'true');
  await expect(saveButton(page, 'Review')).toBeDisabled();
  await tab(page, /^Steps/).click();
  await expect(open.getByText('Can’t save yet')).toBeVisible();
  await open.getByRole('button', { name: 'Show in When it runs' }).click();
  await triggers.getByLabel('Only on branches').fill('release/*');
  await expect(triggers).toContainText('No chat is on a matching branch right now.');

  await triggers.getByLabel('Wait').fill('soon');
  await expect(triggers).toContainText('Wait takes a whole number of minutes from 0 to 1440.');
  await expect(saveButton(page, 'Review')).toBeDisabled();
  await triggers.getByLabel('Wait').fill('5');
  await expect(saveButton(page, 'Review')).toBeEnabled();

  await page
    .getByRole('group', { name: 'What these runs may do' })
    .getByRole('switch', { name: 'Triggered and scheduled runs may change files' })
    .click();
  await saveButton(page, 'Review').click();
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.log).toEqual(['triggers']);
  expect(api.when.triggerSaves.at(-1)).toMatchObject({
    commit: true,
    branchGlob: 'release/*',
    debounceMinutes: 5,
    edits: true,
  });

  await triggers.getByRole('switch', { name: 'A chat starts' }).click();
  await open.getByRole('button', { name: 'Workflows' }).click();
  await leave.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('list', { name: 'Workflows' })).toBeVisible();
  expect(api.when.triggerSaves).toHaveLength(1);
});

test('a save that half works says which part did not save and keeps the draft', async ({
  page,
}) => {
  const { api, open } = await savedWorkflow(page);
  api.when.scheduleFailure = 'That project is not in Spark.';
  await open.getByRole('textbox', { name: 'Workflow name' }).fill('Review twice');
  await tab(page, /^When it runs/).click();
  await page.getByRole('switch', { name: 'Run on a schedule' }).click();
  await page.getByRole('switch', { name: 'A turn changes files' }).click();
  await saveButton(page, 'Review twice').click();

  const renamed = editor(page, 'Review twice');
  await expect(renamed.getByRole('alert')).toContainText(
    'The schedule didn’t save: That project is not in Spark. The steps and the triggers are saved. Your changes are still here.',
  );
  expect(api.log).toEqual(['workflow', 'schedule', 'triggers']);
  await expect(unsaved(page, '1 unsaved change')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Run on a schedule' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  api.when.scheduleFailure = null;
  await saveButton(page, 'Review twice').click();
  await expect(renamed.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect(renamed.getByRole('alert')).toHaveCount(0);
  expect(api.log).toEqual(['workflow', 'schedule', 'triggers', 'schedule']);
});

test('Run saves an unsaved draft first, and can take a message', async ({ page }) => {
  const { api } = await savedWorkflow(page);
  await tab(page, /^When it runs/).click();
  await page.getByRole('switch', { name: 'A chat starts' }).click();
  await runNow(page, 'Review', 'Save and run with a message and project…');
  expect(api.log).toEqual(['triggers']);

  const form = page.getByRole('form', { name: 'Run Review' });
  await form.getByLabel('What this run is about').fill('Check the last merge.');
  await form.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Run of Review' })).toBeVisible();
  expect(api.runBodies).toEqual([{ projectId: null, message: 'Check the last merge.' }]);

  await page.getByRole('button', { name: 'Back to the workflow' }).click();
  await expect(tab(page, /^When it runs/)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('switch', { name: 'A turn changes files' }).click();
  await runNow(page, 'Review', 'Save and run now');
  await expect(page.getByRole('region', { name: 'Run of Review' })).toBeVisible();
  expect(api.log).toEqual(['triggers', 'triggers']);
  expect(api.runBodies.at(-1)).toEqual({});
});

test('the Runs tab is the one list: runs with where they started, quiet triggers and a held publish', async ({
  page,
}) => {
  const security = await addSpark(page, 'Security', 'Finds risky changes');
  const api = await fakeWorkflowApi(page, [security]);
  api.put({ id: 'review', name: 'Review', steps: [step('security', security)] });
  const at = (hour: number, minute: number) => new Date(2026, 10, 16, hour, minute).toISOString();
  api.pastRuns = [
    {
      id: '00000000-0000-4000-8000-00000000a001',
      workflowId: 'review',
      workflowName: 'Review',
      kind: 'run',
      source: 'trigger',
      pull: '#327',
      status: 'succeeded',
      conversationId: null,
      runId: null,
      stoppedBy: null,
      steps: [],
      spend: { tokens: 0, costUsd: null, costSource: null },
      startedAt: at(10, 30),
      finishedAt: at(10, 32),
    },
  ];
  api.when.events = [
    {
      id: '00000000-0000-4000-8000-00000000e001',
      kind: 'commit',
      conversationId: CHAT,
      chatTitle: 'Fix the divider',
      state: 'skipped',
      reason: 'unchanged',
      detail: null,
      dueAt: at(9, 0),
      workflowRunId: null,
      updatedAt: at(9, 1),
    },
  ];
  api.when.holds = [
    {
      id: '00000000-0000-4000-8000-00000000d001',
      conversationId: CHAT,
      chatTitle: 'Fix the divider',
      workflowId: 'review',
      findings: 2,
      finished: true,
      state: 'open',
      createdAt: at(8, 0),
    },
  ];
  await page.clock.setFixedTime(new Date(2026, 10, 16, 10, 40));
  await page.goto(PANEL_PATH);
  await page.getByRole('button', { name: 'Edit Review' }).click();
  await tab(page, /^Runs/).click();
  await expect(tab(page, /^Runs/)).toHaveText('Runs 1');

  const rows = page.getByRole('list', { name: 'Runs' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(
    /Before publish.*Held publish.*2 Critical or High findings/,
  );
  await expect(rows.nth(1)).toContainText(/Today · 10:30.*Triggered · #327.*Done/);
  await expect(rows.nth(2)).toContainText(/Triggered · New commit.*Skipped.*Nothing changed/);
  const results = await new AxeBuilder({ page }).include('.wf-panel').analyze();
  expect(results.violations).toEqual([]);
  await animationsSettled(page);
  await page.screenshot({ path: `${SHOTS}/runs-light.png` });

  await rows.nth(0).getByRole('button', { name: 'Release hold' }).click();
  await expect(rows).toHaveCount(2);
  expect(api.when.released).toEqual(['00000000-0000-4000-8000-00000000d001']);

  await rows.nth(0).getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Run of Review' })).toBeVisible();
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
  await expect(
    stepRow(page, 'security').getByRole('button', { name: 'Edit Security' }),
  ).toBeFocused();
  await expect(inspector(page, 'Security')).toBeVisible();

  await open.getByRole('button', { name: 'Add a stage' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /^Lint/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(stepRow(page, 'lint').getByRole('button', { name: 'Edit Lint' })).toBeFocused();
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);

  const lint = inspector(page, 'Lint');
  const earlier = lint.getByRole('button', { name: 'Move Lint to an earlier stage' });
  await tabTo(page, earlier);
  await page.keyboard.press('Enter');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  await expect(lint.getByRole('button', { name: 'Move Lint to a later stage' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);
  await expect(earlier).toBeFocused();

  const after = lint.getByRole('checkbox', { name: 'Security' });
  await tabTo(page, after);
  await expect(after).toBeChecked();
  await page.keyboard.press('Space');
  await expect(stage(page, 1).getByRole('listitem')).toHaveCount(2);
  await expect(after).toBeFocused();
  await page.keyboard.press('Space');
  await expect(stage(page, 2).getByRole('listitem')).toHaveCount(1);
  await expect(after).toBeFocused();

  await tabTo(page, lint.getByRole('radio', { name: 'Stop workflow' }));
  await page.keyboard.press('ArrowRight');
  await expect(lint.getByRole('radio', { name: 'Continue' })).toBeChecked();

  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await tabTo(page, graphNodes(page).getByRole('button', { name: 'Edit Security' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(inspector(page, 'Security')).toBeVisible();

  await open.getByRole('button', { name: 'Preview' }).focus();
  await page.keyboard.press('Enter');
  await open.getByRole('checkbox', { name: 'Pretend Security fails' }).focus();
  await page.keyboard.press('Space');
  await expect(open.locator('.wf-result')).toContainText("Lint doesn't start.");
  await open.getByRole('button', { name: 'Back to editing' }).focus();
  await page.keyboard.press('Enter');

  await saveButton(page, 'Keys only').focus();
  await page.keyboard.press('Enter');
  await expect(open.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(api.files.get('keys-only')?.workflow.steps).toMatchObject([
    { id: 'security', dependsOn: [] },
    { id: 'lint', dependsOn: ['security'], onFailure: 'continue' },
  ]);
});
