import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addSpark, openSparksPage } from './crew-files-kit.ts';
import { step } from './crew-flows-kit.ts';
import { chatRepo, resetWithAgents, type ChatRepo } from './project-chat-kit.ts';
import { animationsSettled } from './settle.ts';

const SHOTS = 'test-results/crew-test-run';
const FLOW = 'test-run-spec';
const BANNER = 'Nothing is pushed, posted or saved.';

test.describe.configure({ timeout: 90_000 });

let repo: ChatRepo;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  const linked = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(linked.ok()).toBe(true);
});

test.afterEach(async ({ page }) => {
  const removed = await page.request.delete(`/api/workflows/${FLOW}`, { data: {} });
  expect([204, 404]).toContain(removed.status());
  repo.remove();
});

const view = (page: Page, name: string) =>
  page.getByRole('region', { name: `Test run of ${name}` });
const copies = () => {
  const folder = path.join(repo.root, '.spark', 'worktrees');
  return existsSync(folder) ? readdirSync(folder) : [];
};
const listedChats = async (page: Page) =>
  (await (await page.request.get('/api/conversations')).json()) as unknown[];

async function pickProject(page: Page) {
  await page.getByRole('button', { name: 'Project to copy', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Project to copy' })
    .getByRole('menuitemradio', { name: new RegExp(`^${path.basename(repo.root)}`) })
    .click();
}

async function shots(page: Page, name: string) {
  await page.mouse.move(0, 0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function passesAxe(page: Page, include: string) {
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include(include)
    .analyze();
  expect(scan.violations).toEqual([]);
}

test('a test run of a workflow lists what it held, then runs for real', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const security = await addSpark(page, {
    name: 'Security',
    role: 'Finds risky changes',
  });
  const comment = await addSpark(page, {
    name: 'Comment',
    role: 'Writes review comments',
  });
  const saved = await page.request.put(`/api/workflows/${FLOW}`, {
    data: {
      baseHash: null,
      workflow: {
        id: FLOW,
        name: 'Pre-PR review',
        steps: [
          { ...step('check', security), prompt: 'Check the site. #curl' },
          {
            ...step('post', comment, ['check']),
            prompt: 'Publish the branch. #push',
          },
        ],
      },
    },
  });
  expect(saved.ok()).toBe(true);

  await openSparksPage(page);
  await page.getByRole('tab', { name: /^Workflows/ }).click();
  await page.getByRole('button', { name: 'Edit Pre-PR review' }).click();
  await page.getByRole('button', { name: 'Test run', exact: true }).click();

  const form = page.getByRole('form', { name: 'Test run of Pre-PR review' });
  await expect(form).toContainText('Tokens are spent and the cost is real.');
  await expect(form).toContainText(
    'A script that reaches an outside service by itself is not stopped by Spark.',
  );
  await passesAxe(page, '.wf-test-start');
  await shots(page, 'start');
  await pickProject(page);
  await form.getByLabel('What this run is about').fill('for 2.4');
  const started = page.waitForResponse(
    (response) => response.url().endsWith(`/api/workflows/${FLOW}/runs`) && response.ok(),
  );
  await form.getByRole('button', { name: 'Start test run' }).click();
  const runId = ((await (await started).json()) as { id: string }).id;

  const run = view(page, 'Pre-PR review');
  await expect(run).toContainText(`throw-away copy of ${path.basename(repo.root)}. ${BANNER}`);
  await expect(run.getByRole('status')).toContainText('Finished', { timeout: 60_000 });
  await expect(run.getByRole('status')).toContainText('2 of 2 done');
  expect(copies()).toHaveLength(1);

  const held = run.getByRole('list', { name: 'Would have been sent' }).getByRole('listitem');
  await expect(held).toHaveCount(2);
  await expect(held.nth(0)).toContainText('Command · Security');
  await expect(held.nth(0)).toContainText('curl');
  await expect(held.nth(0)).toContainText('Not sent');
  await expect(held.nth(1)).toContainText('Push · Comment');
  await expect(held.nth(1)).toContainText('git push origin main');

  const steps = run.getByRole('list', { name: 'Steps' });
  await expect(steps.getByRole('button', { name: /Comment.*Done/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const output = run.getByRole('region', { name: 'Step output' });
  await expect(output).toContainText('fake-push=denied');
  await steps.getByRole('button', { name: /Security/ }).focus();
  await page.keyboard.press('Enter');
  await expect(output).toContainText('fake-curl=denied');
  await expect(run).toContainText('Closing this view deletes the copy and this run.');
  await passesAxe(page, '.wf-test');
  await shots(page, 'finished');

  expect(await listedChats(page)).toEqual([]);

  await run.getByRole('button', { name: 'Run for real' }).click();
  await expect(page.getByRole('region', { name: 'Workflow Pre-PR review' })).toContainText(
    'Started',
  );
  await expect.poll(() => copies()).toEqual([]);
  expect((await page.request.get(`/api/workflow-runs/${runId}/test`)).status()).toBe(404);
  await expect.poll(async () => (await listedChats(page)).length).toBe(1);
});

test('Try it runs one Spark and Discard removes the run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addSpark(page, { name: 'Security', role: 'Finds risky changes' });
  await openSparksPage(page);
  await page
    .locator('main.sparks')
    .getByRole('button', { name: /^Open Security\./ })
    .click();

  const form = page.getByRole('form', { name: 'Try it' });
  await form.scrollIntoViewIfNeeded();
  await pickProject(page);
  await form.getByLabel('What this run is about').fill('Review the last commit. #curl');
  const started = page.waitForResponse(
    (response) => response.url().endsWith('/test-runs') && response.ok(),
  );
  await form.getByRole('button', { name: 'Try it' }).click();
  const runId = ((await (await started).json()) as { id: string }).id;

  const run = view(page, 'Security');
  await expect(run.getByRole('status')).toContainText('Finished', { timeout: 60_000 });
  await expect(run.getByRole('button', { name: 'Run for real' })).toHaveCount(0);
  await expect(
    run.getByRole('list', { name: 'Would have been sent' }).getByRole('listitem'),
  ).toContainText('Command · Security');
  await passesAxe(page, '.wf-test');
  await shots(page, 'try-it');

  await run.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('form', { name: 'Try it' })).toBeVisible();
  expect((await page.request.get(`/api/workflow-runs/${runId}/test`)).status()).toBe(404);
  expect(copies()).toEqual([]);
  expect(await listedChats(page)).toEqual([]);
});

test('leaving the view deletes the test run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addSpark(page, { name: 'Security', role: 'Finds risky changes' });
  await openSparksPage(page);
  await page
    .locator('main.sparks')
    .getByRole('button', { name: /^Open Security\./ })
    .click();
  const form = page.getByRole('form', { name: 'Try it' });
  await pickProject(page);
  const started = page.waitForResponse(
    (response) => response.url().endsWith('/test-runs') && response.ok(),
  );
  await form.getByRole('button', { name: 'Try it' }).click();
  const runId = ((await (await started).json()) as { id: string }).id;
  await expect(view(page, 'Security')).toBeVisible();

  await page.getByRole('button', { name: 'All Sparks' }).click();

  await expect
    .poll(async () => (await page.request.get(`/api/workflow-runs/${runId}/test`)).status())
    .toBe(404);
  await expect.poll(() => copies()).toEqual([]);
});
