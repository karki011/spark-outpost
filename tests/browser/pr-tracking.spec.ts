import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  pollTrackedPullsNow,
  pullUrl,
  runSql,
  SEED_PULLS,
  SEED_TITLE,
  seedTrackedPulls,
} from './pr-tracking-seed.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const SHOTS = process.env.PR_TRACKING_SHOTS ?? '';
const POLLED = { timeout: 45_000 };

test.describe.configure({ timeout: 120_000 });

const check = (id: number, name: string, status: string, conclusion: string | null) => ({
  id,
  name,
  status,
  conclusion,
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
});

async function addPull(request: APIRequestContext, fields: Record<string, unknown>) {
  const response = await request.post(`${STUB_URL}/github-test/pulls`, { data: fields });
  expect(response.ok()).toBe(true);
}

test.beforeEach(async ({ page, request }) => {
  await resetTestDatabase({ onboarded: true });
  await request.post(`${STUB_URL}/github-test/reset`);
  writeFileSync(FAKE_GH_STATE, 'maya');
  await addPull(request, {
    number: 7,
    title: 'Tidy the notes',
    head: 'spark/tidy-the-notes-0a1b2c3d',
    checks: [check(71, 'lint', 'completed', 'success'), check(72, 'test', 'completed', 'failure')],
    reviews: [{ user: { login: 'alice' }, state: 'CHANGES_REQUESTED' }],
  });
  await addPull(request, {
    number: 8,
    title: 'Add a changelog',
    head: 'feature/changelog',
    draft: true,
    checks: [check(81, 'lint', 'completed', 'failure'), check(82, 'test', 'in_progress', null)],
  });
  await addPull(request, {
    number: 3,
    repo: 'gadgets',
    title: 'Fix the docs',
    head: 'fix-docs',
    html_url: 'https://github.com/acme/gadgets/pull/3',
    checks: [check(31, 'docs', 'completed', 'success')],
    reviews: [{ user: { login: 'alice' }, state: 'APPROVED' }],
  });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => rmSync(FAKE_GH_STATE, { force: true }));

async function shoot(page: Page, name: string, target: Locator) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await target.screenshot({
      path: path.join(SHOTS, `${name}-${scheme}.png`),
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

const group = (page: Page) => page.getByRole('group', { name: '4 pull requests', exact: true });

async function showInLinks(page: Page) {
  await group(page).getByRole('button', { name: '4 pull requests, details' }).focus();
  await page.keyboard.press('Enter');
  const rows = group(page).getByRole('group', { name: /^Pull request acme\// });
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveAccessibleName('Pull request acme/vault#12');
  await group(page).getByRole('button', { name: 'Pull request acme/widgets#7 details' }).click();
  await group(page).getByRole('button', { name: 'Show in Links' }).click();
  await page.keyboard.press('Escape');
}

const links = (page: Page) => page.getByRole('region', { name: 'Pull requests' });
const row = (page: Page, number: number) =>
  links(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^#${number} `) }) });

test('a chat lists every pull request it opened, by repo, with checks and reviews', async ({
  page,
}) => {
  await seedTrackedPulls();
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(SEED_TITLE);

  await expect(group(page)).toContainText('4 open · 1 failing', POLLED);
  await expect(page.locator('header.chat-head')).not.toContainText('4 PRs');
  await shoot(page, 'composer-card', page.locator('.composer-wrap'));
  await showInLinks(page);
  await expect(page.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');

  const groups = links(page).getByRole('heading', { level: 3 });
  await expect(groups).toHaveText(['acme/widgets', 'acme/gadgetsoutside', 'acme/vaultoutside']);
  await expect(
    links(page)
      .getByRole('list', { name: 'Pull requests in acme/widgets' })
      .getByRole('link', {
        name: /^#\d+ /,
      }),
  ).toHaveText(['#8 Add a changelog', '#7 Tidy the notes']);

  const tidy = row(page, 7);
  await expect(tidy.getByRole('link', { name: '#7 Tidy the notes' })).toHaveAttribute(
    'href',
    pullUrl({ owner: 'acme', repo: 'widgets', number: 7 }),
  );
  await expect(tidy).toContainText('Open');
  await expect(tidy).toContainText('Checks failing');
  await expect(tidy).toContainText('Changes requested');
  await expect(tidy).toContainText('spark/tidy-the-notes-0a1b2c3d → main');
  await expect(tidy).toContainText('Opened by Claude');
  const failing = tidy.getByRole('list', { name: 'Failing checks on #7' });
  await expect(failing.getByRole('listitem')).toHaveText(['testFailed']);
  await expect(failing.getByRole('link', { name: 'test' })).toHaveAttribute(
    'href',
    'https://github.com/acme/widgets/actions/runs/72',
  );

  const changelog = row(page, 8);
  await expect(changelog).toContainText('Draft');
  await expect(changelog).toContainText('Checks running');
  await expect(changelog).toContainText('Opened from the terminal');
  await expect(
    changelog.getByRole('list', { name: 'Failing checks on #8' }).getByRole('listitem'),
  ).toHaveText(['lintFailed']);

  const docs = row(page, 3);
  await expect(docs).toContainText('Checks passing');
  await expect(docs).toContainText('Approved');

  const vault = links(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: '#12 Pull request' }) });
  await expect(vault).toContainText('Checks unknown');
  await expect(vault).not.toContainText('Open');
  await expect(vault).toContainText(
    'Your GitHub connection can’t read acme/vault (404). Give it access to this repository to see checks and reviews.',
  );
  await expect(vault).toContainText('Found on this chat’s branch');

  await shoot(page, 'links-tab', page.getByRole('complementary', { name: 'Work panel' }));

  const turn = page.getByRole('region', { name: 'Turn' });
  const opened = turn.locator('.pr-opened');
  await expect(opened).toHaveText('Opened 2 pull requests#7#3');
  await expect(opened.getByRole('link', { name: '#7 in acme/widgets' })).toHaveAttribute(
    'href',
    pullUrl({ owner: 'acme', repo: 'widgets', number: 7 }),
  );
  await shoot(page, 'turn-row', turn);
});

test('checks move from failing to passing without reopening the chat', async ({
  page,
  request,
}) => {
  await seedTrackedPulls();
  await openChats(page);
  await expect(group(page)).toContainText('4 open · 1 failing', POLLED);

  await request.post(`${STUB_URL}/github-test/pulls/7`, {
    data: {
      checks: [
        check(71, 'lint', 'completed', 'success'),
        check(72, 'test', 'completed', 'success'),
      ],
    },
  });
  await pollTrackedPullsNow();
  await expect(group(page)).not.toContainText('failing', POLLED);
  await expect(group(page)).toContainText('4 open');
  await showInLinks(page);
  await expect(row(page, 7)).toContainText('Checks passing');
});

test('Refresh reads a pull request Spark stopped checking, from the row and from Links', async ({
  page,
}) => {
  await seedTrackedPulls([SEED_PULLS[0]!]);
  await openChats(page);
  const card = page.getByRole('group', { name: 'Pull request acme/widgets#7', exact: true });
  const state = card.locator('.prc-state');
  await expect(state).toHaveText('Open', POLLED);

  const stop = `UPDATE pr_watches SET pr_state = 'closed', phase = 'done', last_polled_at = now(),
    next_poll_at = now() + interval '1 day'`;
  await runSql(stop);
  await expect(state).toHaveText('Closed');
  const refresh = card.getByRole('button', { name: 'Refresh pull request #7' });
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(state).toHaveText('Open');
  await expect(refresh).toBeFocused();
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await expect(card.getByRole('alert')).toHaveCount(0);

  await runSql(stop);
  await expect(state).toHaveText('Closed');
  await card.getByRole('button', { name: 'Pull request acme/widgets#7 details' }).click();
  await card.getByRole('button', { name: 'Show in Links' }).click();
  const linksState = row(page, 7).locator('.prl-facts > .spill').first();
  await expect(linksState).toHaveText('Closed');
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/pull-requests\/[^/]+\/refresh$/.test(response.url()),
  );
  await row(page, 7).getByRole('button', { name: 'Refresh pull request #7' }).press('Space');
  expect((await refreshed).ok()).toBe(true);
  await expect(linksState).toHaveText('Open');
  await expect(state).toHaveText('Open');
});
