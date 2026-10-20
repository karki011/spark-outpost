import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

async function openSparkRules(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Spark rules' })
    .click();
  return page.getByRole('dialog', { name: 'Spark rules' });
}

const rules = async (page: Page) => (await page.request.get('/api/spark-rules')).json();

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('Spark rules lists the gh rules, lets workflows be refused and keeps the floor fixed', async ({
  page,
}) => {
  await page.goto('/');
  const settings = await openSparkRules(page);
  await expect(
    settings.getByText("What Spark lets a chat's agent do, on top of the agent's own mode."),
  ).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'GitHub commands' })).toBeVisible();
  await expect(settings.getByText('Always allowed')).toBeVisible();
  await expect(settings.getByText('Publish rules')).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Always on (safety floor)' })).toBeVisible();
  await expect(settings.getByText('Fixed')).toHaveCount(3);

  const workflow = settings.getByRole('button', { name: 'Run a workflow' });
  await expect(workflow).toContainText("Follows the agent's mode");
  await workflow.click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/spark-rules') && response.request().method() === 'PUT',
  );
  await page.getByRole('menuitemradio', { name: 'Refused' }).click();
  await saved;
  await expect(workflow).toContainText('Refused');
  await expect(
    settings.getByText(/are refused in every mode, with a card to allow them/),
  ).toBeVisible();
  expect(await rules(page)).toMatchObject({ workflows: 'refused' });

  await page.reload();
  const again = await openSparkRules(page);
  await expect(again.getByRole('button', { name: 'Run a workflow' })).toContainText('Refused');
});

test('allowed commands take gh prefixes, refuse the never-allowed ones and can be removed', async ({
  page,
}) => {
  await page.goto('/');
  const settings = await openSparkRules(page);
  const input = settings.getByRole('textbox', { name: 'Allowed commands' });
  const add = settings.getByRole('button', { name: 'Add', exact: true });

  await input.fill('gh pr merge');
  await add.click();
  await expect(settings.getByText('Spark never merges a pull request.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.fill('gh release create v1');
  await add.click();
  await expect(
    settings.getByText('Use gh and two words, such as gh release create.'),
  ).toBeVisible();

  await input.fill('  GH release   create ');
  await input.press('Enter');
  const list = settings.getByRole('list', { name: 'Allowed commands' });
  await expect(list.getByText('gh release create')).toBeVisible();
  await expect(input).toHaveValue('');
  expect(await rules(page)).toMatchObject({ ghAllowed: ['gh release create'] });
  await expect(settings.getByText(/stay refused even when added/)).toBeVisible();

  await settings.getByRole('button', { name: 'Remove gh release create' }).click();
  await expect(list).toHaveCount(0);
  await expect.poll(async () => (await rules(page)).ghAllowed).toEqual([]);
});
