import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { workPanel } from './permissions-kit.ts';
import {
  BUILD_REQUEST,
  card,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';

let repo: ChatRepo;

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test("the agent's plan shows on the approval card, and once approved one quiet line opens it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await projectChat(page, repo, 'Ask before edits');
  await send(page, 'Add CSV export #planmode #build');

  const approval = card(page, /Approve the plan\?/);
  await expect(approval).toContainText('wrote a plan and wants to start building', {
    timeout: 30_000,
  });
  await expect(page.locator('.cstatus').getByRole('status')).toHaveText(
    'Waiting for you: plan to review',
  );
  await expect(page.locator('.plan-line')).toHaveCount(0);
  const plan = approval.getByRole('region', { name: 'Proposed plan' });
  await expect(plan.getByRole('heading', { name: 'Add CSV export' })).toBeVisible();
  await expect(plan.getByRole('listitem').first()).toContainText('src/export.ts');
  await approval.getByRole('button', { name: 'Yes, manually approve edits' }).click();
  await expect(approval.getByRole('status')).toContainText('Plan approved.');
  await expect(page.getByText('Plan approved with exit-plan-default').first()).toBeVisible({
    timeout: 30_000,
  });

  const line = page.getByRole('button', { name: /^Plan saved.*\. Open the plan$/ });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line).toHaveText(/^Plan saved/);
  await expect(page.locator('.plan-line')).toHaveCount(1);
  const results = await new AxeBuilder({ page })
    .include('.plan-line')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await line.focus();
  await page.keyboard.press('Enter');
  const agreed = workPanel(page).getByRole('region', { name: 'Agreed plan' });
  await expect(agreed).toBeVisible();
  await expect(agreed).toContainText('Approved');
  await expect(agreed).toContainText('Claude plan mode');
  await expect(agreed.getByRole('heading', { name: 'Add CSV export' })).toBeVisible();
  await expect(workPanel(page).getByRole('tab', { name: 'Plan' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.reload();
  await expect(page.locator('.plan-line')).toHaveCount(1);
});

test('a build with no approved plan shows no Plan saved line', async ({ page }) => {
  test.setTimeout(60_000);
  await projectChat(page, repo, 'Full auto');
  await send(page, `${BUILD_REQUEST} #build`);
  await turnDone(page);
  await expect(page.locator('.plan-line')).toHaveCount(0);
  await expect(card(page, /Approve the plan\?/)).toHaveCount(0);
});
