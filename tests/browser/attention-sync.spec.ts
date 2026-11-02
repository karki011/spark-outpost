import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island } from './island-home-desktop.ts';
import { openChats } from './navigation.ts';
import { notifyChanged, seedApproval, seedChats, type SeedApproval } from './sidebar-seed.ts';

const runTests: SeedApproval = { kind: 'execute', title: 'pnpm test', command: 'pnpm test' };

async function sql(text: string, values: unknown[] = []) {
  const db = openTestDb();
  try {
    return await db.query(text, values);
  } finally {
    await db.end();
  }
}

async function captureReports(page: Page) {
  await page.addInitScript(() => {
    const desktop = (window as unknown as { sparkDesktop: Record<string, unknown> }).sparkDesktop;
    const reports: { count: number }[] = [];
    Object.assign(window, { attentionReports: reports });
    desktop.attention = { report: (report: { count: number }) => reports.push(report) };
  });
}

async function islandCount(page: Page): Promise<number> {
  const count = island(page).locator('.isl-pbadge');
  return (await count.count()) > 0 ? Number(await count.innerText()) : 0;
}

async function dockCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const reports = (window as unknown as { attentionReports: { count: number }[] })
      .attentionReports;
    return reports.at(-1)?.count ?? 0;
  });
}

async function appCount(page: Page): Promise<number> {
  const match = /^\((\d+)\)/.exec(await page.title());
  return match ? Number(match[1]) : 0;
}

async function counts(app: Page, isl: Page) {
  return [await islandCount(isl), await appCount(app), await dockCount(isl)];
}

async function expectCounts(app: Page, isl: Page, count: number) {
  await expect.poll(() => counts(app, isl), { timeout: 10_000 }).toEqual([count, count, count]);
}

async function openHome(isl: Page) {
  await isl.mouse.move(640, 600);
  await island(isl)
    .getByRole('button', { name: /Open Spark Island/ })
    .first()
    .click();
  await expect(island(isl)).toHaveAttribute('data-view', 'panel');
}

async function closeHome(isl: Page) {
  await isl.keyboard.press('Escape');
  await expect(island(isl)).not.toHaveAttribute('data-view', 'panel');
  await isl.mouse.move(640, 600);
}

test('the island, the app and the Dock count the same requests at every step', async ({
  context,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [, deployId] = await seedChats([
    { title: 'Current chat', minutesAgo: 0 },
    { title: 'Deploy the site', run: { status: 'running' }, minutesAgo: 5 },
  ]);
  const app = await context.newPage();
  await openChats(app);
  await expect(app.locator('.chat-title')).toHaveText('Current chat');
  const isl = await context.newPage();
  await fakeHomeDesktop(isl, 'graphite', false);
  await captureReports(isl);
  await isl.setViewportSize({ width: 1280, height: 720 });
  await isl.goto('/island');
  await expect(island(isl)).toBeVisible();
  await expectCounts(app, isl, 0);

  const first = await seedApproval(deployId!, runTests);
  await expectCounts(app, isl, 1);
  await expect(app.getByText('Deploy the site needs your permission')).toBeVisible();

  await openHome(isl);
  await island(isl)
    .getByRole('button', { name: /Open chat/ })
    .click();
  await expectCounts(app, isl, 0);
  await openHome(isl);
  const card = island(isl).getByRole('article', { name: 'Deploy the site needs you' });
  await expect(card.getByText('Seen')).toBeVisible();
  await closeHome(isl);

  await sql(`UPDATE approvals SET status = 'allowed', decided_at = now() WHERE id = $1`, [first]);
  const second = await seedApproval(deployId!, runTests);
  await expectCounts(app, isl, 1);

  await openHome(isl);
  await island(isl).getByRole('button', { name: 'Later' }).click();
  await expect(island(isl).getByRole('region', { name: /^Set aside/ })).toBeVisible();
  await closeHome(isl);
  await expectCounts(app, isl, 0);
  await isl.reload();
  await expect(island(isl)).toBeVisible();
  await expectCounts(app, isl, 0);

  await sql(`UPDATE approvals SET status = 'denied', decided_at = now() WHERE id = $1`, [second]);
  await seedApproval(deployId!, runTests);
  await expectCounts(app, isl, 1);
  await openHome(isl);
  const answering = island(isl).getByRole('article', { name: 'Deploy the site needs you' });
  await answering.getByRole('button', { name: /^Allow/ }).click();
  await expect(answering).toHaveCount(0);
  await closeHome(isl);
  await expectCounts(app, isl, 0);
  await expect(app.getByText('Deploy the site needs your permission')).toBeHidden();

  const third = await seedApproval(deployId!, runTests);
  await expectCounts(app, isl, 1);
  await sql(`UPDATE approvals SET status = 'cancelled', decided_at = now() WHERE id = $1`, [third]);
  await sql(
    `UPDATE runs SET status = 'cancelled', finished_at = now() WHERE conversation_id = $1`,
    [deployId],
  );
  await notifyChanged('approval', deployId!);
  await expectCounts(app, isl, 0);
});

test('opening the chat in the app reads it everywhere, and the card stays pinned until answered', async ({
  context,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [, deployId] = await seedChats([
    { title: 'Current chat', minutesAgo: 0 },
    { title: 'Deploy the site', run: { status: 'running' }, minutesAgo: 5 },
  ]);
  const isl = await context.newPage();
  await fakeHomeDesktop(isl, 'graphite', false);
  await captureReports(isl);
  await isl.setViewportSize({ width: 1280, height: 720 });
  await isl.goto('/island');
  const app = await context.newPage();
  await openChats(app);
  await seedApproval(deployId!, runTests);
  await expectCounts(app, isl, 1);

  await app
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('listitem')
    .filter({ hasText: 'Deploy the site' })
    .first()
    .click();
  await expect(app.locator('.chat-title')).toHaveText('Deploy the site');
  await expectCounts(app, isl, 0);
  const pinned = app.getByRole('group', { name: /^Run .+\?$/ });
  await expect(pinned).toBeVisible();
  await expect(pinned.getByRole('button', { name: /^Allow/ })).toBeVisible();
  await openHome(isl);
  await expect(
    island(isl).getByRole('article', { name: 'Deploy the site needs you' }).getByText('Seen'),
  ).toBeVisible();
});

test('a Spark flag never counts, chimes or shows in the island, and Got it clears it in the chat', async ({
  context,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [flaggedId] = await seedChats([
    { title: 'Send the report', run: { status: 'succeeded' }, minutesAgo: 1 },
  ]);
  const { rows } = await sql(
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL LIMIT 1`,
    [flaggedId],
  );
  await sql(
    `INSERT INTO rail_flags (id, run_id, conversation_id, rail, title, paths, inside, originals)
     VALUES (gen_random_uuid(), $1, $2, 'sent_out',
       'Fake provider sent data to example.com after reading .env', '["example.com"]', false, '[]')`,
    [(rows[0] as { id: string }).id, flaggedId],
  );
  const isl = await context.newPage();
  await fakeHomeDesktop(isl, 'graphite', false);
  await captureReports(isl);
  await isl.setViewportSize({ width: 1280, height: 720 });
  await isl.goto('/island');
  const app = await context.newPage();
  await openChats(app);
  await notifyChanged('conversation', flaggedId!);
  await expectCounts(app, isl, 0);
  await expect(island(isl)).toHaveAttribute('data-view', 'peek');
  await expect(app.getByText('needs you in')).toHaveCount(0);

  await app.locator('.chat-title').waitFor();
  await expect(app.locator('.chat-title')).toHaveText('Send the report');
  const line = app.locator('.flag-line');
  await expect(line).toContainText('Flag: Fake provider sent data to example.com');
  await line.getByRole('button', { name: 'Details' }).click();
  const flag = app.getByRole('region', { name: 'Flagged by Spark' });
  await expect(flag).toContainText('sent data to example.com after reading .env');
  await flag.getByRole('button', { name: 'Got it' }).click();
  await expect(line).toHaveClass(/\bsettled\b/);
  await expect(line).toContainText('Dismissed.');
  await expect(flag.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await expectCounts(app, isl, 0);
});
