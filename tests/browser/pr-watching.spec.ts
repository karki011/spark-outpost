import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
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
const SHOTS = process.env.PR_WATCH_SHOTS ?? '';
const POLLED = { timeout: 45_000 };
const TIDY = SEED_PULLS[0]!;
const FREEZE = "last_polled_at = now() + interval '1 day', next_poll_at = now() + interval '1 day'";
const APPROVED = [{ id: 1, user: { login: 'alice' }, state: 'APPROVED' }];

test.describe.configure({ timeout: 150_000 });

const check = (id: number, status: string, conclusion: string | null) => ({
  id,
  name: 'test',
  status,
  conclusion,
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
});

async function addPull(request: APIRequestContext, fields: Record<string, unknown> = {}) {
  const pull = { number: 7, title: 'Tidy the notes', head: TIDY.branch, ...fields };
  expect((await request.post(`${STUB_URL}/github-test/pulls`, { data: pull })).ok()).toBe(true);
}

async function changePull(request: APIRequestContext, fields: Record<string, unknown>) {
  await request.post(`${STUB_URL}/github-test/pulls/7`, { data: fields });
  await pollTrackedPullsNow();
}

test.beforeEach(async ({ page, request }) => {
  await resetTestDatabase({ onboarded: true });
  await request.post(`${STUB_URL}/github-test/reset`);
  writeFileSync(FAKE_GH_STATE, 'maya');
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SHOTS, `${name}-${scheme}.png`),
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

const card = (page: Page) =>
  page.getByRole('group', { name: 'Pull request acme/widgets#7', exact: true });
const row = (page: Page) => card(page).locator('.prc-row');
const mark = (page: Page) => row(page).locator('.prw-mark');
const panel = (page: Page) => card(page).locator('.prc-panel');
const detail = (page: Page) => panel(page).locator('.prw-detail');
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Pull request acme/widgets#7 details' });
const status = (page: Page) => page.getByRole('region', { name: 'PR status' }).getByRole('status');
const box = async (target: Locator) => (await target.boundingBox())!;

async function openFollowed(page: Page) {
  const { conversationId } = await seedTrackedPulls([TIDY]);
  await runSql('UPDATE pr_watches SET follow_up = true, doing = $1', [
    'Watching checks and reviews.',
  ]);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(SEED_TITLE);
  return conversationId;
}

async function startRound(conversationId: string): Promise<string> {
  const [messageId, runId, builderId] = [randomUUID(), randomUUID(), randomUUID()];
  await runSql(
    `INSERT INTO messages (id, conversation_id, role, content)
     VALUES ($1, $2, 'user', 'Spark: CI failed on PR #7 (test), so I asked this chat to look')`,
    [messageId, conversationId],
  );
  await runSql(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source, started_at)
     VALUES ($1, $2, $3, 'fake', 'running', 'pr_follow_up', now())`,
    [runId, conversationId, messageId],
  );
  await runSql(
    `INSERT INTO orchestrations (run_id, phase, depth, depth_source, risk, routing)
     VALUES ($1, 'building', 'execute', 'rules', 'edits', 'pinned')`,
    [runId],
  );
  await runSql(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, source, started_at,
       parent_run_id, role, step_index, attempt, agent_label, route)
     VALUES ($1, $2, $3, 'fake', 'running', 'pr_follow_up', now(), $4, 'builder', 0, 1,
       'Bolt · Builder', '{"name":"Bolt"}')`,
    [builderId, conversationId, messageId, runId],
  );
  await runSql(
    `UPDATE pr_watches SET phase = 'fixing', rounds = 2, round_run_id = $1,
       doing = 'Fixing 1 item (round 2 of 3).', ${FREEZE}`,
    [runId],
  );
  return runId;
}

async function leaveItemForYou(runId: string) {
  await runSql(
    "UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1 OR parent_run_id = $1",
    [runId],
  );
  await runSql(
    `INSERT INTO pr_feedback_items (id, watch_id, source_key, label, kind, github_id, author,
       trusted, body, triage, triaged_by, state, round)
     SELECT $1, id, 'review_comment:9', 'F1', 'review_comment', '9', 'alice', true,
       'Should this also rename the folder?', 'disagree', 'rules', 'needs_user', 2
     FROM pr_watches`,
    [randomUUID()],
  );
  await runSql(
    `UPDATE pr_watches SET phase = 'needs_you', round_run_id = NULL,
       doing = '1 item needs you. Watching checks and reviews.', ${FREEZE}`,
  );
}

test('the row says who is watching, from the first check to the merge, without moving', async ({
  page,
  request,
}) => {
  await addPull(request, { reviews: APPROVED });
  const conversationId = await openFollowed(page);

  await expect(mark(page)).toHaveText('Watching', POLLED);
  await expect(mark(page)).toHaveAccessibleName(
    /^Spark is watching\. Spark is watching checks and reviews\. Checked (just now|\d+s ago) · next check in (\d+s|\d min)\.$/,
  );
  await expect(mark(page)).toHaveClass(/quiet/);
  await expect(mark(page)).not.toHaveClass(/pulse/);
  await expect(status(page)).toHaveText('Pull request #7: Open, Spark is watching');
  const composer = await box(page.locator('.composer'));
  const collapsed = await box(row(page));
  expect(collapsed.height).toBe(32);

  await mark(page).hover();
  await expect(page.getByRole('tooltip')).toContainText('Spark is watching checks and reviews.');
  await page.mouse.move(0, 0);
  await shoot(page, 'watching');

  await changePull(request, { checks: [check(71, 'in_progress', null)] });
  await expect(status(page)).toHaveText(
    'Pull request #7: Open, Checks running, Waiting for checks',
    POLLED,
  );
  await expect(mark(page)).toHaveClass(/live pulse/);
  await expect(mark(page).locator('.prw-short')).toHaveCount(0);
  await expect(mark(page)).toHaveAccessibleName(/^Waiting for checks\. Checks are running\./);
  expect(await box(row(page))).toEqual(collapsed);
  await shoot(page, 'waiting-for-checks');

  await runSql(
    `UPDATE pr_watches SET checks = 'failing', ${FREEZE},
       failing_checks = '[{"name":"test","url":null}]'::jsonb`,
  );
  await expect(row(page)).toContainText('Checks failingWatchingOpen');
  await expect(mark(page)).not.toHaveClass(/pulse/);

  const runId = await startRound(conversationId);
  await expect(row(page)).toContainText('Checks failingRound 2 of 3Agent is on itOpen');
  await expect(status(page)).toHaveText(
    'Pull request #7: Open, Checks failing, Round 2 of 3, Agent is on it',
  );
  await expect(mark(page)).toHaveClass(/live pulse/);
  await expect(mark(page)).toHaveAccessibleName(
    'Agent is on it. Fake provider · Bolt · Builder is working on round 2 of 3.',
  );
  expect((await box(row(page))).height).toBe(32);
  await toggle(page).click();
  await expect(detail(page)).toContainText(
    'Agent is on itFake provider · Bolt · Builder is working on round 2 of 3.',
  );
  await shoot(page, 'agent-on-it');
  await page.keyboard.press('Escape');

  await leaveItemForYou(runId);
  await expect(row(page)).toContainText('Checks failing1 need you1 new commentOpen');
  await expect(status(page)).toHaveText(
    'Pull request #7: Open, Checks failing, 1 need you, 1 new comment, Needs you',
  );
  await expect(mark(page)).toHaveClass(/warn/);
  await expect(mark(page)).not.toHaveClass(/pulse/);
  await expect(mark(page)).toHaveAccessibleName('Needs you. 1 item is left for you.');
  expect((await box(row(page))).height).toBe(32);
  await shoot(page, 'needs-you');

  const axe = await new AxeBuilder({ page }).include('.prc').analyze();
  expect(axe.violations).toEqual([]);

  await changePull(request, { state: 'closed', merged: true });
  await expect(row(page)).toContainText('Merged', POLLED);
  await expect(mark(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Pull request #7: Merged');
  await toggle(page).click();
  await expect(detail(page)).toHaveCount(0);
  expect((await box(row(page))).height).toBe(32);
  expect((await box(page.locator('.composer'))).height).toBe(composer.height);
});

test('with follow-up off the row says so and the panel has the switch to turn it on', async ({
  page,
  request,
}) => {
  await addPull(request, { reviews: APPROVED });
  expect((await request.patch('/api/profile', { data: { prFollowUp: false } })).ok()).toBe(true);
  await openFollowed(page);

  await expect(mark(page)).toHaveAccessibleName(
    /^Follow-up is off\. Follow up on pull requests is off, so Spark won’t fix checks or answer reviews here\. Checks and reviews still update\. Checked /,
    POLLED,
  );
  await expect(mark(page)).toHaveText('Follow-up off');
  const collapsed = await box(row(page));
  const composer = await box(page.locator('.composer'));

  await toggle(page).click();
  await expect(detail(page)).toContainText('Follow-up is off');
  await expect(panel(page).locator('.prc-doing')).toHaveCount(0);
  await shoot(page, 'follow-up-off');
  const followUp = detail(page).getByRole('switch', { name: 'Follow up on pull requests' });
  await expect(followUp).not.toBeChecked();
  await followUp.focus();
  await page.keyboard.press('Space');
  await expect(mark(page)).toHaveText('Watching');
  await expect(detail(page).getByRole('switch')).toHaveCount(0);
  await expect(status(page)).toHaveText('Pull request #7: Open, Spark is watching');
  expect((await (await request.get('/api/setup')).json()).profile.prFollowUp).toBe(true);
  expect(await box(row(page))).toEqual(collapsed);
  expect(await box(page.locator('.composer'))).toEqual(composer);

  expect((await request.patch('/api/profile', { data: { prFollowUpAsk: true } })).ok()).toBe(true);
  await page.reload();
  await expect(mark(page)).toHaveText('Watching');
  await toggle(page).click();
  await expect(detail(page)).toContainText('Spark asks before pushing and replying.');
  const ask = detail(page).getByRole('switch', { name: 'Ask before pushing and replying' });
  await expect(ask).toBeChecked();
  await ask.click();
  await expect(detail(page).getByRole('switch')).toHaveCount(0);
  await expect(detail(page)).not.toContainText('asks before');
});

test('a check that fails pauses watching and says why, and so does missing access', async ({
  page,
  request,
}) => {
  await addPull(request, { reviews: APPROVED });
  await openFollowed(page);
  await expect(mark(page)).toHaveText('Watching', POLLED);
  const collapsed = await box(row(page));

  await runSql(
    `UPDATE pr_watches SET poll_problem = 'error', last_error = 'GitHub answered 502 Bad Gateway',
       last_polled_at = now() + interval '1 day', next_poll_at = now() + interval '10 minutes 30 seconds'`,
  );
  await expect(mark(page)).toHaveText('Paused');
  await expect(mark(page)).toHaveClass(/warn/);
  await expect(mark(page)).not.toHaveClass(/pulse/);
  await expect(mark(page)).toHaveAccessibleName(
    'Watching is paused. The last check failed: GitHub answered 502 Bad Gateway. Spark tries again in 10 min.',
  );
  await expect(status(page)).toHaveText('Pull request #7: Open, Watching is paused');
  expect(await box(row(page))).toEqual(collapsed);
  await toggle(page).click();
  await expect(detail(page)).toContainText('Watching is paused');
  await expect(panel(page)).not.toContainText('Last check failed:');
  await expect(panel(page).locator('.prc-doing')).toHaveCount(0);
  await shoot(page, 'paused');

  await runSql("UPDATE pr_watches SET poll_problem = 'rate_limit', last_error = 'limit'");
  await expect(detail(page)).toContainText('GitHub’s rate limit is used up. Spark tries again');
  await runSql("UPDATE pr_watches SET poll_problem = 'offline', last_error = 'fetch failed'");
  await expect(detail(page)).toContainText('Spark can’t reach GitHub. Spark tries again');

  await request.post(`${STUB_URL}/github-test/reset`);
  await pollTrackedPullsNow();
  await expect(mark(page)).toHaveText('Not watching', POLLED);
  await expect(detail(page)).toContainText(
    'Your GitHub connection can’t read acme/widgets (404). Give it access to this repository to see checks and reviews. Spark tries again in',
  );
  await expect(panel(page).locator('.prc-note')).toHaveCount(0);
  await shoot(page, 'not-watching');

  await addPull(request, { reviews: APPROVED });
  await pollTrackedPullsNow();
  await expect(mark(page)).toHaveText('Watching', POLLED);
  expect(await box(row(page))).toEqual(collapsed);
});

test('used-up rounds and a status-only pull request say what Spark will not do', async ({
  page,
  request,
}) => {
  await addPull(request, { reviews: APPROVED });
  await openFollowed(page);
  await expect(mark(page)).toHaveText('Watching', POLLED);
  await runSql(`UPDATE pr_watches SET rounds = 3, ${FREEZE}`);
  await expect(mark(page)).toHaveText('3 of 3 rounds used');
  await expect(mark(page)).toHaveAccessibleName(
    /^Not following up\. 3 of 3 rounds used\. Ask in the chat for another round\./,
  );

  await runSql('UPDATE pr_watches SET rounds = 0, follow_up = false');
  await expect(mark(page)).toHaveText('Tracking');
  await toggle(page).click();
  await expect(detail(page)).toContainText(
    'Spark shows checks and reviews here. It follows up only on pull requests from this chat’s own branch.',
  );
  await expect(detail(page).getByRole('switch')).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Show in Links' }).click();
  const links = page
    .getByRole('complementary', { name: 'Work panel' })
    .getByRole('region', { name: 'Pull requests' });
  await expect(links.locator('.prw-detail')).toContainText('Spark is tracking');
  await runSql(`UPDATE pr_watches SET follow_up = true, checks = 'pending', ${FREEZE}`);
  await expect(links.locator('.prw-detail')).toContainText('Waiting for checksChecks are running.');
  await shoot(page, 'links-card');
  const axe = await new AxeBuilder({ page }).include('.prl').analyze();
  expect(axe.violations).toEqual([]);
});

test('the eye pulses only while something runs, and never with reduced motion', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await addPull(request, { reviews: APPROVED, checks: [check(71, 'in_progress', null)] });
  await openFollowed(page);
  const eye = mark(page).locator('.prw-eye');
  const animation = () => eye.evaluate((node) => getComputedStyle(node).animationName);
  await expect(mark(page)).toHaveClass(/pulse/, POLLED);
  expect(await animation()).toBe('prw-pulse');

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  expect(await animation()).toBe('none');

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await changePull(request, { checks: [check(72, 'completed', 'success')] });
  await expect(mark(page)).toHaveText('Watching', POLLED);
  expect(await animation()).toBe('none');
});

test('on a phone the indicator is one icon with its full name, and the row keeps 44px', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addPull(request, {
    title: 'Tidy the notes and keep every heading in the order the team agreed on',
    reviews: APPROVED,
  });
  await openFollowed(page);
  await expect(mark(page)).toHaveAccessibleName(/^Spark is watching\./, POLLED);
  await expect(mark(page).locator('.prw-short')).toBeHidden();
  const line = await box(row(page));
  expect(line.height).toBe(44);
  const eye = await box(mark(page));
  const state = await box(row(page).locator('.prc-state'));
  expect(eye.x + eye.width).toBeLessThanOrEqual(state.x);
  expect(state.x + state.width).toBeLessThanOrEqual(line.x + line.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shoot(page, 'phone-watching');

  await runSql(`UPDATE pr_watches SET phase = 'needs_you', doing = 'Left for you.', ${FREEZE}`);
  await expect(mark(page)).toHaveAccessibleName('Needs you. Left for you.');
  expect(await box(row(page))).toEqual(line);

  expect((await request.patch('/api/profile', { data: { prFollowUp: false } })).ok()).toBe(true);
  await runSql(`UPDATE pr_watches SET phase = 'watching', ${FREEZE}`);
  await page.reload();
  await expect(mark(page)).toHaveAccessibleName(/^Follow-up is off\./);
  const composer = await box(page.locator('.composer'));
  await toggle(page).click();
  const open = await box(panel(page));
  expect(open.x + open.width).toBeLessThanOrEqual(390);
  expect(open.y + open.height).toBeLessThanOrEqual(line.y);
  const followUp = detail(page).getByRole('switch', { name: 'Follow up on pull requests' });
  expect((await box(followUp)).height).toBeGreaterThanOrEqual(44);
  expect(await box(page.locator('.composer'))).toEqual(composer);
  await shoot(page, 'phone-follow-up-off');

  await page.route('**/api/remote/session', async (route) => {
    const session = await (await route.fetch()).json();
    await route.fulfill({
      json: { ...session, remote: true, switches: { ...session.switches, settings: false } },
    });
  });
  await page.reload();
  await toggle(page).click();
  await expect(followUp).toBeDisabled();
  await expect(detail(page)).toContainText('Turned off for phones on your Mac');
});
