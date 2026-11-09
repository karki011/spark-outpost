import { rmSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  pollTrackedPullsNow,
  runSql,
  SEED_PULLS,
  SEED_TITLE,
  seedTrackedPulls,
} from './pr-tracking-seed.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const POLLED = { timeout: 45_000 };
const HEAD = '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c';
const NEXT_HEAD = '2a3b4c5d6e7f80912a3b4c5d6e7f80912a3b4c5d';
const [TIDY] = SEED_PULLS;
const OFFER = 'Follow up on this PR? #7';
const CLEAN = 'PR is clean · ready to merge';

test.describe.configure({ timeout: 120_000 });

const passing = (id: number) => ({
  id,
  name: 'test',
  status: 'completed',
  conclusion: 'success',
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
});

async function addPull(request: APIRequestContext, fields: Record<string, unknown>) {
  const data = { number: 7, title: SEED_TITLE, head: TIDY!.branch, sha: HEAD, ...fields };
  expect((await request.post(`${STUB_URL}/github-test/pulls`, { data })).ok()).toBe(true);
}

async function changePull(request: APIRequestContext, fields: Record<string, unknown>) {
  await request.post(`${STUB_URL}/github-test/pulls/7`, { data: fields });
  await pollTrackedPullsNow();
}

test.beforeEach(async ({ page, request }) => {
  await resetTestDatabase({ onboarded: true });
  await request.post(`${STUB_URL}/github-test/reset`);
  writeFileSync(FAKE_GH_STATE, 'maya');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function openFollowed(page: Page) {
  await seedTrackedPulls([TIDY!]);
  await runSql("UPDATE pr_watches SET follow_up = true, opened_via = 'agent'");
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(SEED_TITLE);
}

const offer = (page: Page) => page.getByRole('group', { name: OFFER });

test('a new pull request offers follow-up when it is off, and Turn on switches it on', async ({
  page,
  request,
}) => {
  await runSql('UPDATE profiles SET pr_follow_up = false');
  await addPull(request, {});
  await openFollowed(page);
  await expect(page.locator('.pr-opened')).toContainText('Opened pull request#7');
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText(
    'Turns on Follow up on pull requests in Settings, for every pull request.',
  );
  const axe = await new AxeBuilder({ page }).include('.pr-offer').analyze();
  expect(axe.violations).toEqual([]);

  const turnOn = offer(page).getByRole('button', { name: 'Turn on' });
  await turnOn.focus();
  await page.keyboard.press('Enter');
  await expect(offer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.pr-opened')).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test('the offer shows when follow-up asks first, can be dismissed, and is not a card', async ({
  page,
  request,
}) => {
  await runSql('UPDATE profiles SET pr_follow_up_ask = true');
  await addPull(request, {});
  await openFollowed(page);
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText(
    'Turns off Ask before pushing and replying in Settings, for every pull request.',
  );
  await expect(page.getByRole('button', { name: /Allow/ })).toHaveCount(0);
  await offer(page).getByRole('button', { name: 'Dismiss the follow-up offer for #7' }).click();
  await expect(offer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.pr-opened')).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test('no offer while follow-up is on, and a ticket that was not moved says why', async ({
  page,
  request,
}) => {
  await addPull(request, {});
  await openFollowed(page);
  await runSql(`UPDATE pr_watches SET ticket_sync_claimed_at = now(), ticket_sync = $1::jsonb`, [
    JSON.stringify([
      { source: 'jira', key: 'WEB-418', outcome: 'succeeded', message: null },
      { source: 'jira', key: 'WEB-420', outcome: 'skipped', message: 'Left at Done.' },
    ]),
  ]);
  await page.reload();
  await expect(page.locator('.pr-ticket-line')).toHaveText([
    'WEB-420 was not moved to review: Left at Done.',
  ]);
  await expect(offer(page)).toHaveCount(0);
});

test('a pull request the Ship panel opened shows its lines under the PR row', async ({
  page,
  request,
}) => {
  await runSql('UPDATE profiles SET pr_follow_up = false');
  await addPull(request, {});
  await seedTrackedPulls([TIDY!]);
  await runSql(
    `UPDATE pr_watches SET follow_up = true, opened_via = 'ship', opened_run_id = NULL,
       ticket_sync_claimed_at = now(), ticket_sync = $1::jsonb`,
    [JSON.stringify([{ source: 'jira', key: 'WEB-9', outcome: 'failed', message: 'No answer.' }])],
  );
  await openChats(page);
  const stack = page.getByRole('region', { name: 'PR status' });
  await expect(stack.locator('.pr-ticket-line')).toHaveText([
    'WEB-9 was not moved to review: No answer.',
  ]);
  await expect(stack.getByRole('group', { name: OFFER })).toBeVisible();
  await expect(page.locator('.pr-opened')).toHaveCount(0);
});

test('a clean pull request says so once, and again only after a new head', async ({
  page,
  request,
}) => {
  await runSql('UPDATE profiles SET pr_follow_up = false');
  await addPull(request, { checks: [passing(91)] });
  await openFollowed(page);
  const clean = page.getByRole('region', { name: 'PR status' }).locator('.prc-clean');
  await expect(clean).toHaveText(CLEAN, POLLED);
  await expect(page.getByRole('region', { name: 'PR status' }).getByRole('status')).toContainText(
    CLEAN,
  );

  await changePull(request, {
    reviewComments: [
      { id: 5, path: 'src/notes.ts', line: 5, user: { login: 'alice' }, body: 'Rename this' },
    ],
  });
  await expect(clean).toHaveCount(0, POLLED);
  await changePull(request, { resolvedComments: [5] });
  await expect(page.locator('.prc-row')).toContainText('Open', POLLED);
  await pollTrackedPullsNow();
  await page.waitForTimeout(2_000);
  await expect(clean).toHaveCount(0);

  await changePull(request, { sha: NEXT_HEAD, checks: [passing(92)] });
  await expect(clean).toHaveText(CLEAN, POLLED);
});
