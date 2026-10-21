import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  fakeHomeDesktop,
  fakeState,
  island,
  homeBody,
  homeTab,
  openHome,
  openIsland,
  shot,
} from './island-home-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

const section = (page: Page, name: RegExp | string) => island(page).getByRole('region', { name });

async function seedInbox() {
  return seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 6,
    },
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 2 },
    { title: 'Tidy the README', run: { status: 'succeeded' }, unread: true, minutesAgo: 1 },
    {
      title: 'Telemetry ingest',
      run: { status: 'failed', error: 'terminal exited' },
      unread: true,
      minutesAgo: 3,
    },
  ]);
}

async function resumeAllowed() {
  await expect
    .poll(async () => (await sql("SELECT 1 FROM approvals WHERE status = 'allowed'")).rowCount)
    .toBe(1);
  await sql(
    `UPDATE runs SET status = 'running' WHERE status = 'awaiting_approval'
       AND conversation_id IN (SELECT conversation_id FROM approvals WHERE status = 'allowed')`,
  );
}

const focusCard = (page: Page, chat: string) =>
  island(page).getByRole('article', { name: `${chat} needs you` });

test('Home shows the top request as one card, working chats below, and no finished runs', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedInbox();
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  await expect(homeTab(page)).toHaveAccessibleName('Home, 1 need you');
  const card = focusCard(page, 'Deploy the site');
  await expect(card).toContainText('pnpm deploy');
  await expect(card.getByRole('button', { name: /^Allow/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Deny/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Later' })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Open chat/ })).toBeVisible();
  await expect(card.getByRole('group', { name: 'Requests' })).toHaveCount(0);
  await expect(section(page, /^Working/)).toContainText('Fix billing totals');
  await expect(homeBody(page)).not.toContainText('Tidy the README');
  await expect(homeBody(page)).not.toContainText('Telemetry ingest');
  await expect(island(page).getByRole('button', { name: 'Open Spark', exact: true })).toBeVisible();
  await shot(page, 'inbox');
  expect((await fakeState(page)).openedChats).toEqual([]);
});

test('Allow and Later act in place and keep the island open; a working tile opens Spark on that chat', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [deploy, billing] = await seedInbox();
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm rotate', command: 'pnpm rotate' },
      minutesAgo: 5,
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  const pager = homeBody(page).getByRole('group', { name: 'Requests' });
  await expect(pager).toContainText('1 of 2');
  const deployCard = focusCard(page, 'Deploy the site');
  await expect(deployCard).toBeVisible();
  await pager.getByRole('button', { name: 'Next request' }).click();
  await expect(focusCard(page, 'Rotate the keys')).toBeVisible();
  await expect(pager).toContainText('2 of 2');
  await pager.getByRole('button', { name: 'Request 1 of 2' }).click();
  await deployCard.getByRole('button', { name: /^Allow/ }).click();
  await resumeAllowed();
  await expect(deployCard).toHaveCount(0);

  const rotate = focusCard(page, 'Rotate the keys');
  await expect(rotate.getByRole('group', { name: 'Requests' })).toHaveCount(0);
  await rotate.getByRole('button', { name: 'Later' }).click();
  await expect(section(page, /^Set aside/)).toContainText('Rotate the keys');
  await expect(section(page, 'Nothing needs you')).toBeVisible();

  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  expect((await fakeState(page)).openedChats).toEqual([]);

  await section(page, /^Working/)
    .getByRole('button', { name: /^Fix billing totals/ })
    .click();
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([billing]);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await expect(island(page)).not.toContainText('Opening Spark');
  expect(deploy).toBeTruthy();
});

test('Y answers the shown request once, and ⌘O opens Spark without a chat', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedInbox();
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const allow = focusCard(page, 'Deploy the site').getByRole('button', { name: /^Allow/ });
  await expect(allow).toBeEnabled();
  await expect(allow.locator('.isl-k')).toHaveText('Y');
  await page.keyboard.press('y');
  await resumeAllowed();
  await expect(section(page, 'Nothing needs you')).toBeVisible();
  await page.keyboard.press('Meta+o');
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([null]);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('a plan that needs typing offers Open chat instead of Allow', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [plan] = await seedChats([
    {
      title: 'pipeline-poc',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'other',
        title: 'Review the plan',
        plan: 'Deploy #353 to alfa now, or wait for review?',
      },
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const card = focusCard(page, 'pipeline-poc');
  await expect(card.getByRole('button', { name: /^Allow/ })).toHaveCount(0);
  await card.getByRole('button', { name: /^Open chat/ }).click();
  await expect.poll(async () => (await fakeState(page)).openedChats).toEqual([plan]);
});

test('an empty inbox says nothing needs you, and New chat, Ask, Sparks and settings stay reachable', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(section(page, 'Nothing needs you')).toBeVisible();
  await expect(section(page, /^Working/)).toHaveCount(0);
  await shot(page, 'inbox-empty');

  await island(page).getByRole('button', { name: 'New chat' }).click();
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
  await island(page).getByRole('button', { name: 'Ask Spark', exact: true }).click();
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();
  await page.keyboard.press('Meta+2');
  await island(page).getByRole('region', { name: 'Your Sparks' }).getByText('New Spark').click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await openHome(page);
  await island(page).getByRole('button', { name: 'Spark Island settings' }).click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new', 'island']);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('⌘1–3 switch panels, the Home tab returns Home, Escape closes, nothing auto-expands', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'succeeded' } }]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await page.keyboard.press('Meta+2');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.keyboard.press('Meta+3');
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toBeFocused();
  await homeTab(page).click();
  await expect(section(page, 'Nothing needs you')).toBeVisible();
  await page.keyboard.press('Meta+2');
  await expect(homeTab(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Meta+1');
  await expect(homeTab(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page, 'Nothing needs you')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await openHome(page);
  await page.evaluate(() => (window as unknown as { islandEscape: () => void }).islandEscape());
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await page.mouse.move(640, 600);
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm rotate', command: 'pnpm rotate' },
    },
  ]);
  await expect(island(page).getByRole('button', { name: /1 need you/ })).toBeAttached();
  await page.waitForTimeout(1500);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('the chime toggle persists and chimes only when it is on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  const chimes = island(page).getByRole('button', { name: 'Island chimes' });
  await expect(chimes).toHaveAttribute('aria-pressed', 'false');
  await seedChats([
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Deploy', command: 'pnpm deploy' },
    },
  ]);
  await expect(homeTab(page)).toHaveAccessibleName('Home, 1 need you');
  expect((await fakeState(page)).chimes).toBe(0);

  await chimes.click();
  await expect(chimes).toHaveAttribute('aria-pressed', 'true');
  expect((await fakeState(page)).sound).toEqual([true]);
  await page.reload();
  await openHome(page);
  await expect(island(page).getByRole('button', { name: 'Island chimes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await seedChats([
    {
      title: 'Rotate the keys',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Rotate', command: 'pnpm rotate' },
    },
  ]);
  await expect(homeTab(page)).toHaveAccessibleName('Home, 2 need you');
  await expect.poll(async () => (await fakeState(page)).chimes).toBeGreaterThan(0);
});

test('reduced motion opens Home in place with no movement', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix image uploads', run: { status: 'running' } }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);
  await expect(section(page, /^Working/)).toContainText('Fix image uploads');
  const moving = await island(page).evaluate((root) =>
    root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running')
      .map((animation) => (animation as CSSAnimation).animationName ?? 'script'),
  );
  expect(moving).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(island(page).locator('.isl-ghost')).toHaveCount(0);
});

test('a Spark tile in New chat starts a follow-up with that Spark right in the island', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await fakeHomeDesktop(page);
  await openIsland(page);
  for (const [name, color] of [
    ['Stripe', 'sky'],
    ['GitHub', 'rose'],
  ]) {
    const response = await page.request.post('/api/teammates', {
      data: { name, role: 'Helper', face: { shape: 'boxy', color } },
    });
    expect(response.status()).toBe(201);
  }
  await openHome(page);
  await island(page).getByRole('button', { name: 'New chat' }).click();
  const tiles = island(page).getByRole('region', { name: 'Your Sparks' }).getByRole('button');
  await expect(tiles).toHaveCount(3);
  await tiles.last().click();
  await expect.poll(async () => (await fakeState(page)).settings).toEqual(['spark-new']);
  await openHome(page);
  await island(page).getByRole('button', { name: 'New chat' }).click();
  await tiles.filter({ hasText: 'GitHub' }).click();
  await expect(island(page)).toContainText('Following up in GitHub');
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    'Reply…',
  );
  expect((await fakeState(page)).openedChats).toEqual([]);
});

test('Review on a force-push card leaves Home for the full card', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Rewrite the release branch',
      run: { status: 'awaiting_approval' },
      approval: {
        kind: 'execute',
        title: 'git push --force',
        command: 'git push --force origin spark/release',
        payload: { forcePush: ['spark/release'] },
      },
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await openHome(page);

  const card = focusCard(page, 'Rewrite the release branch');
  await expect(card.getByRole('button', { name: /^Allow/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  await card.getByRole('button', { name: 'Review' }).click();
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page)).toContainText('Rewrites history on spark/release');
});

const NIGHT_SKINS = ['graphite', 'void', 'moss', 'plum', 'aurora'];

for (const theme of ['apricot', 'graphite']) {
  test(`in the ${theme} app theme Home is night glass with no accessibility problems`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await resetTestDatabase({ onboarded: true });
    await seedInbox();
    await fakeHomeDesktop(page, theme);
    await openIsland(page);
    await openHome(page);
    expect(NIGHT_SKINS).toContain(await page.evaluate(() => document.documentElement.dataset.skin));
    const problems: string[] = [];
    const check = async (view: string) => {
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page }).include('.isl-root').analyze();
      for (const violation of results.violations) {
        if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
        problems.push(
          `${view}: ${violation.id} ${violation.nodes.map((node) => node.target).join(' ')}`,
        );
      }
    };
    await check('inbox');
    await shot(page, `inbox-${theme}`, 0);
    await page.keyboard.press('Meta+2');
    await check('new');
    await page.keyboard.press('Meta+3');
    await check('ask');
    expect(problems).toEqual([]);
  });
}
