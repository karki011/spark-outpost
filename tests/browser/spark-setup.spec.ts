import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addSpark, openSparksPage } from './crew-files-kit.ts';
import { fakeWorkflowApi } from './crew-flows-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const WORKFLOW_ID = `risk-review-${Date.now().toString(36)}`;
const UNKNOWN_SPARK = '00000000-0000-4000-8000-00000000dead';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/workflows/${WORKFLOW_ID}`, { data: {} });
});

const sparksMain = (page: Page) => page.locator('main.sparks');
const setup = (page: Page) => page.getByRole('tabpanel', { name: 'Setup' });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const step = (id: string, sparkId: string) => ({
  id,
  sparkId,
  prompt: '',
  dependsOn: [],
  join: 'all' as const,
  onFailure: 'stop' as const,
});

async function openSpark(page: Page, name: string) {
  await sparksMain(page)
    .getByRole('button', { name: new RegExp(`^Open ${name}\\.`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function pick(page: Page, picker: string, choice: RegExp) {
  await setup(page).getByRole('button', { name: picker, exact: true }).click();
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: choice })
    .click();
}

async function newChat(page: Page) {
  await openChats(page);
  await sidebar(page).getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
}

test('the Spark page edits what it runs on in place, says what that means and where it is used', async ({
  page,
}) => {
  const pip = await addSpark(page, {
    name: 'Pip',
    role: 'Code reviewer',
    provider: 'claude',
    agentMode: 'plan',
    instructions: 'Name the file and line you mean.',
  });
  await addSpark(page, { name: 'Wren', role: 'Lead', instructions: 'Hand risky changes to Pip.' });
  const saved = await page.request.put(`/api/workflows/${WORKFLOW_ID}`, {
    data: {
      workflow: { id: WORKFLOW_ID, name: 'Risk review', steps: [step('judge', pip)] },
      baseHash: null,
    },
  });
  expect(saved.status()).toBe(200);

  await openSparksPage(page);
  await openSpark(page, 'Pip');
  await expect(page.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  const means = setup(page).getByTestId('spark-means');
  await expect(means).toContainText('Pip reads and reports. It changes no files.');

  await pick(page, 'Mode', /^Auto/);
  await expect(means).toContainText('Pip changes files without asking');
  await expect(sparksMain(page).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await pick(page, 'Spark autonomy', /^Full auto/);
  await expect(means).toContainText('opens its own pull request');
  const stored = (await (await page.request.get('/api/teammates')).json()) as {
    teammates: { name: string; agentMode: string | null; level: string | null }[];
  };
  expect(stored.teammates.find((entry) => entry.name === 'Pip')).toMatchObject({
    agentMode: 'auto',
    level: 'full-auto',
  });

  const usedIn = setup(page).getByRole('region', { name: 'Used in' });
  await expect(usedIn).toContainText('Risk review');
  await expect(usedIn).toContainText('Workflow · step 1 of 1');
  await expect(usedIn).toContainText('Wren');
  await expect(setup(page).getByRole('region', { name: 'Instructions' })).toContainText(
    'Name the file and line you mean.',
  );
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('main.sparks')
    .analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const activity = page.getByRole('tabpanel', { name: 'Activity' });
  await expect(activity).toContainText('0 chats');
  await expect(activity).toContainText('0 @ jobs');
  await expect(activity).toContainText('0 workflow steps');

  await page.getByRole('tab', { name: 'Setup' }).click();
  await usedIn.getByRole('button', { name: 'Open the workflow Risk review' }).click();
  await expect(page.getByRole('region', { name: 'Workflow Risk review' })).toBeVisible();
});

test('Use for new chats starts every new chat as that Spark until the user picks another', async ({
  page,
}) => {
  await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  await addSpark(page, { name: 'Wren', role: 'Docs writer' });
  await openSparksPage(page);
  await openSpark(page, 'Pip');
  const toggle = setup(page).getByRole('switch', { name: 'Use for new chats' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(setup(page)).toContainText('Now: no Spark.');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(setup(page)).toContainText('Now: Pip.');

  await newChat(page);
  const talking = page.getByRole('button', { name: 'Talking to Pip' });
  await expect(talking).toBeVisible();
  await talking.click();
  const menu = page.getByRole('menu', { name: 'Talk to' });
  await expect(menu.getByRole('menuitemradio', { name: /Pip/ })).toContainText(
    'Used for new chats',
  );
  await menu.getByRole('menuitemradio', { name: /No Spark/ }).click();
  await expect(page.getByRole('button', { name: 'Talk to…' })).toBeVisible();

  await newChat(page);
  await expect(page.getByRole('button', { name: 'Talking to Pip' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Review my branch');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'Turn' }).first()).toContainText('Review my');
  const chats = (await (await page.request.get('/api/conversations')).json()) as {
    teammate: { name: string } | null;
  }[];
  expect(chats.map((chat) => chat.teammate?.name ?? null)).toEqual(['Pip']);

  await openSparksPage(page);
  await openSpark(page, 'Wren');
  await expect(setup(page)).toContainText('Now: Pip.');
  await setup(page).getByRole('switch', { name: 'Use for new chats' }).click();
  await expect(setup(page)).toContainText('Now: Wren.');
});

test('the @ picker lists every workflow and Spark with its kind, and marks one it cannot run', async ({
  page,
}) => {
  const pip = await addSpark(page, { name: 'Pip', role: 'Code reviewer' });
  const flows = await fakeWorkflowApi(page, [pip]);
  for (let index = 1; index <= 8; index += 1) {
    flows.put({ id: `flow-${index}0`, name: `Flow ${index}`, steps: [step('look', pip)] });
  }
  flows.put({ id: 'broken-flow', name: 'Broken flow', steps: [step('look', UNKNOWN_SPARK)] });
  await openChats(page);
  await sidebar(page).getByRole('button', { name: 'New chat' }).click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeFocused();

  await input.pressSequentially('@');
  const sparks = page.getByRole('listbox', { name: 'Sparks' });
  const workflows = page.getByRole('listbox', { name: 'Workflows' });
  await expect(sparks.getByRole('option', { name: /Pip/ })).toContainText('Spark');
  await expect(workflows.getByRole('option')).toHaveCount(9);
  await expect(workflows.getByRole('option', { name: /Flow 8/ })).toContainText('Workflow');
  const broken = workflows.getByRole('option', { name: /Broken flow/ });
  await expect(broken).toHaveAttribute('aria-disabled', 'true');
  await expect(broken).toContainText('Has problems');

  await broken.click({ force: true });
  await expect(input).toHaveValue('@');
  flows.put({ id: 'late-flow', name: 'Late flow', steps: [step('look', pip)] });
  await input.fill('');
  await input.pressSequentially('@late');
  await expect(workflows.getByRole('option')).toHaveCount(1);
  await workflows.getByRole('option', { name: /Late flow/ }).click();
  await expect(input).toHaveValue('@late-flow ');
});
