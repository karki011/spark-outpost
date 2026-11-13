import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addSpark, fakeWorkflowApi, PANEL_PATH, step } from './crew-flows-kit.ts';
import { fakeScheduleApi } from './crew-schedule-kit.ts';
import { resetTestDatabase } from './database.ts';
import { animationsSettled } from './settle.ts';
import { PACKAGED } from './stub-config.ts';

const SHOTS = 'test-results/crew-schedule';
const MONDAY_MORNING = new Date(2026, 10, 16, 10, 40);
const RUN = {
  workflowId: 'pre-pr-review',
  workflowName: 'Pre-PR review',
  kind: 'run',
  conversationId: null,
  runId: null,
  stoppedBy: null,
  steps: [],
};

test.skip(
  PACKAGED || Boolean(process.env.SPARK_WEB_BUILD),
  'the schedule routes are faked on the dev-server preview page, like the Workflows panel spec',
);

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 10, day, hour, minute).toISOString();

async function openSchedule(page: Page) {
  const security = await addSpark(page, 'Security', 'Finds risky changes');
  const workflows = await fakeWorkflowApi(page, [security]);
  workflows.put({
    id: 'pre-pr-review',
    name: 'Pre-PR review',
    steps: [step('security', security)],
  });
  const schedules = await fakeScheduleApi(page);
  schedules.lastRunCostUsd = 0.2;
  schedules.runs = [
    {
      ...RUN,
      id: '00000000-0000-4000-8000-00000000a001',
      source: 'schedule',
      status: 'succeeded',
      startedAt: at(16, 10, 30),
      finishedAt: at(16, 10, 32),
    },
    {
      ...RUN,
      id: '00000000-0000-4000-8000-00000000a002',
      source: 'manual',
      status: 'failed',
      startedAt: at(16, 9, 42),
      finishedAt: at(16, 9, 44),
    },
  ];
  const quiet = { detail: null, source: 'schedule', workflowRunId: null, releasedAt: null };
  schedules.slots = [
    {
      ...quiet,
      id: '00000000-0000-4000-8000-00000000b001',
      slotAt: at(16, 9, 30),
      lastSlotAt: at(16, 9, 30),
      state: 'skipped',
      reason: 'previous_running',
    },
    {
      ...quiet,
      id: '00000000-0000-4000-8000-00000000b002',
      slotAt: at(15, 17, 30),
      lastSlotAt: at(15, 17, 30),
      state: 'held',
      reason: 'paused',
    },
  ];
  await page.clock.setFixedTime(MONDAY_MORNING);
  await page.goto(PANEL_PATH);
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  await row.getByRole('button', { name: 'Edit Pre-PR review' }).click();
  const editor = page.getByRole('region', { name: 'Workflow Pre-PR review' });
  await editor.getByRole('tab', { name: 'Schedule' }).click();
  return {
    schedules,
    editor,
    form: page.getByRole('group', { name: 'Schedule of Pre-PR review' }),
  };
}

test('a workflow runs every 30 minutes on weekdays, shows what is next and turns off', async ({
  page,
}) => {
  const { schedules, editor, form } = await openSchedule(page);
  const toggle = form.getByRole('switch', { name: 'Run on a schedule' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(form).toContainText('Off · nothing starts on its own');

  await form.getByLabel('Every').fill('30');
  await form.getByRole('radio', { name: 'Minutes' }).click();
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await form.getByRole('button', { name: day }).click();
  }
  await form.getByLabel('From').fill('09:00');
  await form.getByLabel('Until').fill('18:00');
  await form.getByLabel('What to tell the workflow').fill('Review what merged since the last run.');

  const next = form.getByRole('list', { name: 'Next runs' }).getByRole('listitem');
  await expect(next).toHaveText([/^Today · 11:00/, /^Today · 11:30/, /^Today · 12:00/]);
  await expect(form).toContainText(
    'About 19 runs a day · about $3.80 a day at the last run’s cost',
  );
  await expect(form).toContainText('Not saved');

  await form.getByRole('button', { name: 'Save schedule' }).click();
  await expect(form.getByText('Saved', { exact: true })).toBeVisible();
  expect(schedules.saves.at(-1)).toMatchObject({
    enabled: false,
    every: 30,
    unit: 'minutes',
    days: [1, 2, 3, 4, 5],
    from: '09:00',
    to: '18:00',
    anchor: '2026-11-16',
    missed: 'run_once',
    message: 'Review what merged since the last run.',
  });
  await expect(editor.locator('.wf-sched-chip')).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(form).toContainText(/On · next run Today · 11:00/);
  expect(schedules.saves.at(-1)?.enabled).toBe(true);
  await expect(editor.locator('.wf-sched-chip')).toContainText('Every 30 min · weekdays');

  const runs = page.getByRole('list', { name: 'Recent runs' }).getByRole('listitem');
  await expect(runs).toHaveCount(4);
  await expect(runs.nth(0)).toContainText(/Today · 10:30.*Scheduled.*Done.*2m 00s/);
  await expect(runs.nth(1)).toContainText(/Run now.*Failed/);
  await expect(runs.nth(2)).toContainText(/Scheduled.*Skipped.*The previous run was still going/);
  await expect(runs.nth(3)).toContainText(/Yesterday.*Held.*Spark was paused/);

  const results = await new AxeBuilder({ page }).include('.wf-panel').analyze();
  expect(results.violations).toEqual([]);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/schedule-${scheme}.png` });
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(schedules.saves.at(-1)?.enabled).toBe(false);
  await expect(editor.locator('.wf-sched-chip')).toHaveCount(0);

  await editor.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('list', { name: 'Workflows' }).locator('.wf-sched-chip')).toHaveCount(
    0,
  );
});

test('a schedule that cannot be saved says why, and days and weeks ask for one time', async ({
  page,
}) => {
  const { form, schedules } = await openSchedule(page);

  await expect(form.getByLabel('At', { exact: true })).toHaveValue('09:00');
  await form.getByRole('radio', { name: 'Hours' }).click();
  await form.getByLabel('From').fill('18:00');
  await form.getByLabel('Until').fill('09:00');
  await expect(form).toContainText('The end of the hours must be after the start.');
  await expect(form.getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  await expect(form.getByRole('switch', { name: 'Run on a schedule' })).toBeDisabled();

  await form.getByLabel('Until').fill('19:00');
  await form.getByRole('switch', { name: 'Run on a schedule' }).click();
  await expect(form.getByRole('switch', { name: 'Run on a schedule' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await form.getByLabel('Until').fill('09:00');
  const toggle = form.getByRole('switch', { name: 'Run on a schedule' });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(schedules.saves.at(-1)).toMatchObject({ enabled: false, to: '19:00' });
  await expect(form).toContainText('Not saved');

  await form.getByRole('radio', { name: 'Weeks' }).click();
  await expect(form.getByLabel('Until')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Save schedule' })).toBeEnabled();
  await expect(form).toContainText('One run a week');
});
