import { expect, test, type Page } from '@playwright/test';
import { card, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const panel = (page: Page) => page.getByRole('complementary', { name: 'Work panel' });

test("Claude's plan shows on the approval card, and once approved it is the agreed plan", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(page, 'Add CSV export #planmode #build');

  const approval = card(page, /Approve the plan\?/);
  await expect(approval).toContainText('wrote a plan and wants to start building', {
    timeout: 30_000,
  });
  await expect(page.locator('.cstatus')).toContainText('Waiting for you · plan to review');
  const plan = approval.getByRole('region', { name: 'Proposed plan' });
  await expect(plan.getByRole('heading', { name: 'Add CSV export' })).toBeVisible();
  await expect(plan.getByRole('listitem').first()).toContainText('src/export.ts');
  await expect(approval.getByRole('button')).toHaveText([
    'Yes, clear context and use auto mode',
    'Yes, and use auto mode',
    'Yes, manually approve edits',
    'No, keep planning',
  ]);
  await approval.getByRole('button', { name: 'No, keep planning' }).focus();
  await approval.getByRole('button', { name: 'Yes, manually approve edits' }).click();
  await expect(approval.getByRole('status')).toContainText('Plan approved.');
  await expect(approval.getByRole('status')).toContainText('Chose: Yes, manually approve edits.');
  await expect(page.getByText('Plan approved with exit-plan-default').first()).toBeVisible({
    timeout: 30_000,
  });

  const work = panel(page);
  await work.getByRole('tab', { name: 'Plan' }).click();
  const agreed = work.getByRole('region', { name: 'Agreed plan' });
  await expect(agreed).toContainText('Approved');
  await expect(agreed.locator('.vbadge')).toHaveText('v1');
  await expect(agreed).toContainText('Claude plan mode');
  await expect(agreed.getByRole('heading', { name: 'Add CSV export' })).toBeVisible();

  await page.reload();
  await work.getByRole('tab', { name: 'Plan' }).click();
  await expect(work.getByRole('region', { name: 'Agreed plan' })).toContainText('Approved');
});

test('a reply you agree to becomes the agreed plan, and older plans fold away in the Plan tab', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, 'How would you add CSV export? #planreply #build');
  const first = page.getByRole('region', { name: 'Turn' }).first();
  await expect(first.getByRole('heading', { name: 'Add CSV export' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Save as agreed plan' })).toHaveCount(0);

  await send(page, 'sounds good, go ahead #agreed #build');
  await expect(first.getByRole('status').filter({ hasText: 'Agreed plan v1' })).toBeVisible({
    timeout: 30_000,
  });
  const second = page.getByRole('region', { name: 'Turn' }).nth(1);
  await expect(second.locator('.crew-foot')).toContainText('Done', { timeout: 30_000 });

  await send(page, 'How would you do the next part? #planreply #build');
  const third = page.getByRole('region', { name: 'Turn' }).nth(2);
  await expect(third.getByRole('heading', { name: 'Add CSV export' })).toBeVisible({
    timeout: 30_000,
  });
  await send(page, 'yes, do that #agreed #build');
  await expect(third.getByRole('status').filter({ hasText: 'Agreed plan v2' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Save as agreed plan' })).toHaveCount(0);

  const work = panel(page);
  await work.getByRole('tab', { name: 'Plan' }).click();
  const agreed = work.getByRole('region', { name: 'Agreed plan' });
  await expect(agreed.locator('.wsec-h .vbadge')).toHaveText('v2');
  await expect(agreed).toContainText('agreed in chat');
  const older = agreed.getByRole('button', { name: 'Older versions · 1' });
  await expect(older).toHaveAttribute('aria-expanded', 'false');
  await older.click();
  await expect(older).toHaveAttribute('aria-expanded', 'true');
  await expect(agreed.locator('.pv')).toContainText('Replaced');
  await expect(agreed.locator('.pv')).toContainText('agreed in chat');
});

test('a plan-only request writes the plan, changes nothing, raises no card and shows no Save as agreed plan button', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Ask before edits');
  await send(
    page,
    "Plan adding CSV export to the reports. Plan only for now: don't change any files. #planreply #build",
  );

  const turn = page.getByRole('region', { name: 'Turn' });
  await expect(turn.getByRole('heading', { name: 'Add CSV export' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(turn.getByText('Answered without changing files.')).toBeVisible();
  await expect(card(page, /Approve the plan\?/)).toHaveCount(0);
  await expect(card(page, /Jev has a question/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as agreed plan' })).toHaveCount(0);
  await expect(page.getByText(/Agreed plan v\d/)).toHaveCount(0);

  expect(repo.notes()).toBe('start\n');
});
