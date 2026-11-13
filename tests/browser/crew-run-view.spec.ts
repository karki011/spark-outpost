import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openSparksPage } from './crew-files-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = 'test-results/crew-run-view';
const SLOW = 30_000;

interface StepInput {
  id: string;
  sparkId: string;
  prompt?: string;
  dependsOn?: string[];
  onFailure?: 'stop' | 'continue';
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let pip: string;
let wren: string;

async function addSpark(page: Page, name: string, role: string): Promise<string> {
  const response = await page.request.post('/api/teammates', {
    data: { name, role, instructions: 'Keep it short.' },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function saveWorkflow(page: Page, id: string, name: string, steps: StepInput[]) {
  const workflow = {
    id,
    name,
    steps: steps.map((step) => ({
      prompt: '',
      dependsOn: [],
      join: 'all',
      onFailure: 'stop',
      ...step,
    })),
  };
  const response = await page.request.put(`/api/workflows/${id}`, {
    data: { workflow, baseHash: null },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function removeWorkflows(page: Page) {
  const listed = (await (await page.request.get('/api/workflows')).json()) as {
    workflows: { id: string }[];
  };
  for (const workflow of listed.workflows) {
    await page.request.delete(`/api/workflows/${workflow.id}`, { data: {} });
  }
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetTestDatabase({ onboarded: true });
  await removeWorkflows(page);
  pip = await addSpark(page, 'Pip', 'Code reviewer');
  wren = await addSpark(page, 'Wren', 'Docs writer');
});

test.afterEach(async ({ page }) => {
  await removeWorkflows(page);
});

async function openWorkflows(page: Page) {
  await openSparksPage(page);
  await page.getByRole('tab', { name: /^Workflows/ }).click();
  await expect(page.getByRole('list', { name: 'Workflows' })).toBeVisible();
}

const runView = (page: Page, name: string) => page.getByRole('region', { name: `Run of ${name}` });
const stepItems = (view: Locator) =>
  view.getByRole('list', { name: 'All steps' }).getByRole('listitem');
const live = (view: Locator) => view.locator('.wf-run-live');

async function shots(page: Page, name: string) {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function passesAxe(page: Page) {
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('main.sparks')
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 80; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Tab never reached the control.');
}

test('Run opens the live view and steps go from Waiting to Running to Done', async ({ page }) => {
  await saveWorkflow(page, 'review-flow', 'Review flow', [
    { id: 'first', sparkId: pip, prompt: 'Look for injection.' },
    { id: 'second', sparkId: wren, dependsOn: ['first'] },
  ]);
  await openWorkflows(page);
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  await expect(row).toContainText('Not run yet');

  await row.getByRole('button', { name: 'Run Review flow' }).click();
  const view = runView(page, 'Review flow');
  const steps = stepItems(view);
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText('Running', { timeout: SLOW });
  await expect(steps.nth(1)).toContainText('Waiting');
  await expect(live(view)).toContainText('Running');
  await expect(live(view)).toContainText('0 of 2 steps done');
  await expect(view.locator('.wf-node[data-state="running"]')).toHaveCount(1);
  await expect(view.locator('.wf-edge.pending')).toHaveCount(1);
  await expect(view.getByRole('button', { name: 'Stop' })).toBeVisible();
  await shots(page, 'running');

  const second = steps.nth(1).getByRole('button');
  await second.focus();
  await expect(steps.nth(1)).toContainText('Running', { timeout: SLOW });
  await expect(steps.nth(0)).toContainText('Done');
  await expect(view.locator('.wf-edge.done')).toHaveCount(1);
  await expect(live(view)).toContainText('2 of 2 steps done', { timeout: SLOW });
  await expect(live(view)).toContainText('Done');
  await expect(steps.nth(1)).toContainText('Done');
  await expect(second).toBeFocused();
  await expect(view.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect(view.locator('.wf-run-status')).toContainText(/[\dK] tokens/);

  await steps.nth(0).getByRole('button').click();
  const panel = view.getByRole('region', { name: 'Step Pip' });
  await expect(panel).toContainText('Pip · Code reviewer');
  await expect(panel.locator('.wf-run-note')).toContainText('Look for injection.');
  await panel.getByRole('list', { name: 'Steps Pip is passed to' }).getByRole('button').click();
  const next = view.getByRole('region', { name: 'Step Wren' });
  await expect(next).toContainText('No later step');
  await passesAxe(page);
  await shots(page, 'done');

  await next.getByRole('button', { name: 'Open this step in the chat' }).click();
  const turn = page.locator('section[data-turn]').first();
  await expect(turn.locator('.agent-block .agent-name')).toHaveText(['Pip', 'Wren']);
  await turn.getByRole('button', { name: 'Open run view' }).click();
  await expect(runView(page, 'Review flow')).toBeVisible();
});

test('a failing step stops the workflow, and the Runs list and last-run line show it', async ({
  page,
}) => {
  await saveWorkflow(page, 'gated', 'Gated flow', [
    { id: 'gate', sparkId: pip, prompt: 'Check it. #fail' },
    { id: 'after', sparkId: wren, dependsOn: ['gate'] },
  ]);
  await openWorkflows(page);
  await page.getByRole('button', { name: 'Run Gated flow' }).click();
  const view = runView(page, 'Gated flow');
  const steps = stepItems(view);
  await expect(live(view)).toContainText('Failed', { timeout: SLOW });
  await expect(steps.nth(0)).toContainText('Failed');
  await expect(steps.nth(1)).toContainText('Skipped');
  await expect(view.locator('.wf-run-outcome')).toHaveText(
    'Stopped by Pip: it failed, and it is set to stop the workflow. 1 step did not start.',
  );
  await expect(view.getByRole('region', { name: 'Step Pip' })).toContainText('#fail');
  await expect(view.locator('.wf-edge.quiet')).toHaveCount(1);
  await passesAxe(page);
  await shots(page, 'failed');

  await page.setViewportSize({ width: 620, height: 900 });
  await expect(steps.nth(0)).toBeVisible();
  await expect(
    view.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).resolves.toBe(true);
  await shots(page, 'narrow');
  await page.setViewportSize({ width: 1280, height: 720 });

  await view.getByRole('button', { name: 'Workflows' }).click();
  const row = page.getByRole('list', { name: 'Workflows' }).getByRole('listitem');
  const last = row.getByRole('button', { name: 'Open the last run of Gated flow' });
  await expect(last).toContainText('Failed');
  await expect(last).toContainText('just now');
  await shots(page, 'list');

  await row.getByRole('button', { name: 'Edit Gated flow' }).click();
  const runs = page.getByRole('region', { name: 'Runs' });
  const runRows = runs.getByRole('listitem');
  await expect(runRows).toHaveCount(1);
  await expect(runRows.first()).toContainText('Run button');
  await expect(runRows.first()).toContainText('Failed');
  await passesAxe(page);
  await shots(page, 'runs');
  await runRows.first().getByRole('button').click();
  await expect(runView(page, 'Gated flow')).toBeVisible();
  await runView(page, 'Gated flow').getByRole('button', { name: 'Back to the workflow' }).click();
  await expect(page.getByRole('region', { name: 'Workflow Gated flow' })).toBeVisible();
});

test('by keyboard alone: run, stop, read a step and go back', async ({ page }) => {
  await saveWorkflow(page, 'long-flow', 'Long flow', [
    { id: 'serve', sparkId: pip, prompt: 'Start it. #terminal=hang' },
    { id: 'after', sparkId: wren, dependsOn: ['serve'] },
  ]);
  await openWorkflows(page);
  await tabTo(page, page.getByRole('button', { name: 'Run Long flow' }));
  await page.keyboard.press('Enter');
  const view = runView(page, 'Long flow');
  const steps = stepItems(view);
  await expect(steps.nth(0)).toContainText('Running', { timeout: SLOW });

  await tabTo(page, view.getByRole('button', { name: 'Stop' }));
  await page.keyboard.press('Enter');
  await expect(live(view)).toContainText('Cancelled', { timeout: SLOW });
  await expect(steps.nth(0)).toContainText('Cancelled');
  await expect(steps.nth(1)).toContainText('Skipped');
  await expect(view.locator('.wf-run-outcome')).toHaveText(
    'Stopped before it finished. Pip was cancelled. 1 step did not start.',
  );
  await expect(view.getByRole('button', { name: /^Stop/ })).toHaveCount(0);
  await shots(page, 'stopped');

  await tabTo(page, steps.nth(1).getByRole('button'));
  await page.keyboard.press('Enter');
  await expect(steps.nth(1).getByRole('button')).toHaveAttribute('aria-current', 'true');
  await expect(view.getByRole('region', { name: 'Step Wren' })).toContainText(
    'This step did not start',
  );
  await tabTo(page, view.getByRole('button', { name: 'Workflows' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Open the last run of Long flow' }));
  await page.keyboard.press('Enter');
  await expect(live(runView(page, 'Long flow'))).toContainText('Cancelled');
});

test('a workflow started with @id in a chat offers its run view', async ({ page }) => {
  await saveWorkflow(page, 'review-flow', 'Review flow', [{ id: 'first', sparkId: pip }]);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('@review-flow look at the login change');
  await input.press('Enter');

  const turn = page.locator('section[data-turn]').first();
  const link = turn.locator('.wf-run-link');
  await expect(link).toContainText('Workflow Review flow', { timeout: SLOW });
  await expect(link).toContainText('Done', { timeout: SLOW });
  await link.getByRole('button', { name: 'Open run view' }).click();
  const view = runView(page, 'Review flow');
  await expect(live(view)).toContainText('1 of 1 step done');
  await expect(view.locator('.wf-tag')).toContainText('From a chat');
});

test('a step waiting on an approval card says so and links to the card', async ({ page }) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-run-view-')));
  const project = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(project.ok()).toBe(true);
  const projectId = ((await project.json()) as { id: string }).id;
  await saveWorkflow(page, 'probe', 'Probe', [
    { id: 'ping', sparkId: pip, prompt: 'Check the site. #curl' },
  ]);
  const started = await page.request.post('/api/workflows/probe/runs', { data: { projectId } });
  expect(started.status(), await started.text()).toBe(201);

  await openWorkflows(page);
  await page.getByRole('button', { name: 'Open the last run of Probe' }).click();
  const view = runView(page, 'Probe');
  const steps = stepItems(view);
  await expect(steps.nth(0)).toContainText('Needs you', { timeout: SLOW });
  await expect(live(view)).toContainText('1 waiting for your answer');
  const panel = view.getByRole('region', { name: 'Step Pip' });
  await expect(panel).toContainText('Waiting for your answer.');
  await passesAxe(page);
  await shots(page, 'needs-you');

  await panel.getByRole('button', { name: 'Open the card' }).click();
  const card = page.locator('[id^="approval-"]').first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.getByRole('button', { name: 'Open run view' }).click();
  await expect(live(runView(page, 'Probe'))).toContainText('1 of 1 step done', { timeout: SLOW });
});
