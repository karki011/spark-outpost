import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const HOUR = 60 * 60 * 1000;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

async function seedPlan(fiveHour = 0.42, kind: 'account' | 'api_key' = 'account'): Promise<void> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO provider_model_access (workspace_id, provider, method, account_kind, account_label)
       VALUES ($1, 'claude', 'cli', $2, 'Claude Max')
       ON CONFLICT (workspace_id, provider) DO UPDATE SET account_kind = EXCLUDED.account_kind`,
      [workspaceId, kind],
    );
    const windows = [
      ['five_hour', fiveHour, new Date(Date.now() + 2 * HOUR)],
      ['seven_day', 0.18, new Date(Date.now() + 72 * HOUR)],
    ] as const;
    for (const [window, used, resetsAt] of windows) {
      await db.query(
        `INSERT INTO provider_plan_limits
           (workspace_id, provider, plan_window, account_label, used, resets_at, limited, observed_at)
         VALUES ($1, 'claude', $2, 'Claude Max', $3, $4, false, now())
         ON CONFLICT (workspace_id, provider, plan_window) DO UPDATE SET used = EXCLUDED.used`,
        [workspaceId, window, used, resetsAt],
      );
    }
    await db.query(
      `INSERT INTO provider_extra_usage
         (workspace_id, provider, account_label, status, in_use, disabled_reason, observed_at)
       VALUES ($1, 'claude', 'Claude Max', 'rejected', false, 'out_of_credits', now())
       ON CONFLICT (workspace_id, provider) DO NOTHING`,
      [workspaceId],
    );
  } finally {
    await db.end();
  }
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const ring = (page: Page) => rail(page).getByRole('button', { name: 'Claude plan limits' });

test('the plan ring shows the most used window and its tooltip names each window', async ({
  page,
}) => {
  await seedPlan(0.74);
  await page.goto('/');
  await expect(ring(page)).toHaveText('74%');
  await expect(ring(page)).toHaveAccessibleDescription(
    /Claude plan 5-hour: 74% · resets .+ Week: 18% · resets .+ Extra usage: not available · out of credits As of the last reply at/,
  );

  await ring(page).click();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('5-hour 74% · resets');
  await expect(tip).toContainText('Week 18% · resets');
  await expect(tip).toContainText('Extra usage not available · out of credits');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  await ring(page).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(ring(page)).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('5-hour 74%');
});

test('the ring appears once a window reaches 70%', async ({ page }) => {
  await seedPlan(0.69);
  await page.goto('/');
  await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(ring(page)).toHaveCount(0);

  await seedPlan(0.7);
  await page.reload();
  await expect(ring(page)).toHaveText('70%');
});

test('there is no plan ring without plan data or for an API-key sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(ring(page)).toHaveCount(0);

  await seedPlan(0.9, 'api_key');
  await page.reload();
  await expect(rail(page).getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(ring(page)).toHaveCount(0);
});

test('the Work panel cost tab shows the plan limits of the chat provider', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await seedPlan();
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task 6/6', { timeout: 20_000 });

  await expect(ring(page)).toHaveCount(0);
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Cost' }).click();
  const plan = panel.getByRole('region', { name: 'Claude plan limits' });
  await expect(plan.getByRole('progressbar', { name: '5-hour limit used' })).toHaveAttribute(
    'aria-valuenow',
    '42',
  );
  await expect(plan.getByRole('progressbar', { name: 'Week limit used' })).toHaveAttribute(
    'aria-valuenow',
    '18',
  );
  await expect(plan).toContainText('Extra usage: not available · out of credits');
});
