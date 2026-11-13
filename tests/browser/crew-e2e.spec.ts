import { expect, test, type Page } from '@playwright/test';
import { crewFileSchema, sparkFolderSchema } from '../../packages/contracts/src/crew-files.ts';
import { workflowRunSchema } from '../../packages/contracts/src/crew-run.ts';
import { workflowFileSchema } from '../../packages/contracts/src/crew-workflow.ts';
import { addSpark, openSparksPage } from './crew-files-kit.ts';
import { resetTestDatabase } from './database.ts';

const WORKFLOW_NAME = `Review ${Date.now().toString(36)}`;
const WORKFLOW_ID = WORKFLOW_NAME.toLowerCase().replace(' ', '-');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/workflows/${WORKFLOW_ID}`);
});

async function pickSpark(page: Page, picker: string, spark: string) {
  await page.getByRole('button', { name: picker, exact: true }).click();
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: new RegExp(`^${spark}`) })
    .click();
}

async function settledRun(page: Page) {
  let latest: unknown = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/workflows/${WORKFLOW_ID}/runs`);
        const { runs } = (await response.json()) as { runs: unknown[] };
        latest = runs[0] ?? null;
        return latest === null ? 'none' : workflowRunSchema.parse(latest).status;
      },
      { timeout: 90_000 },
    )
    .not.toMatch(/^(none|running)$/);
  return workflowRunSchema.parse(latest);
}

test('a Spark with a skill and a two-step workflow are built on the page and run through the real routes', async ({
  page,
}) => {
  const security = await addSpark(page, { name: 'Security', role: 'Finds risky changes' });
  await addSpark(page, { name: 'Comment', role: 'Writes review comments' });

  await openSparksPage(page);
  await page
    .locator('main.sparks')
    .getByRole('button', { name: /^Open Security\./ })
    .click();
  await page.getByRole('button', { name: 'Edit instructions' }).click();
  await page
    .getByRole('textbox', { name: /^Contents of / })
    .fill('Review the diff for injection and secret handling problems.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.spk-editor-h').getByRole('status')).toContainText('Saved');

  await page.getByRole('button', { name: 'New skill' }).click();
  const skill = page.getByRole('form', { name: 'New skill' });
  await skill.getByLabel('Name').fill('dependency-audit');
  await skill.getByLabel('Description').fill('Check changed dependencies.');
  await skill.getByRole('button', { name: 'Create skill' }).click();
  await expect(
    page.getByRole('heading', { name: 'skills/dependency-audit/SKILL.md' }),
  ).toBeVisible();

  const instructions = crewFileSchema.parse(
    await (await page.request.get(`/api/teammates/${security}/files?path=SPARK.md`)).json(),
  );
  expect(instructions.text).toContain('injection');
  const folder = sparkFolderSchema.parse(
    await (await page.request.get(`/api/teammates/${security}/folder`)).json(),
  );
  expect(folder.skills).toEqual([
    { name: 'dependency-audit', description: 'Check changed dependencies.' },
  ]);
  expect(folder.problems).toEqual([]);

  await page.getByRole('button', { name: 'All Sparks' }).click();
  await page.getByRole('tab', { name: /^Workflows/ }).click();
  await page.getByRole('button', { name: 'New workflow' }).first().click();
  const form = page.getByRole('form', { name: 'New workflow' });
  await form.getByRole('textbox', { name: 'Name' }).fill(WORKFLOW_NAME);
  await form.getByRole('button', { name: 'Open in editor' }).click();
  const open = page.getByRole('region', { name: `Workflow ${WORKFLOW_NAME}` });
  await pickSpark(page, 'Add the first Spark', 'Security');
  await pickSpark(page, 'Add a stage', 'Comment');
  await open.getByRole('button', { name: 'Save' }).click();
  await expect(open.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  const saved = workflowFileSchema.parse(
    await (await page.request.get(`/api/workflows/${WORKFLOW_ID}`)).json(),
  );
  expect(saved.workflow.steps.map((step) => step.dependsOn)).toEqual([[], ['security']]);

  await open.getByRole('button', { name: 'Run' }).click();
  await expect(open.getByRole('status').filter({ hasText: 'Started' })).toBeVisible();
  const run = await settledRun(page);
  expect(run.source).toBe('manual');
  expect(run.steps.map((step) => [step.stepId, step.state])).toEqual([
    ['security', 'succeeded'],
    ['comment', 'succeeded'],
  ]);
  expect(run.status).toBe('succeeded');

  await open.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('list', { name: 'Workflows' })).toContainText(WORKFLOW_NAME);
});
