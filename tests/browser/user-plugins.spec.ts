import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { UserPlugin } from '../../packages/contracts/src/user-plugins.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  fixtures,
  mockPlugins,
  openPlugins,
  plugin,
  warpDetailsFixture,
} from './user-plugin-fixtures.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

function manyFixtures(): UserPlugin[] {
  const [egm, warp, sync] = fixtures();
  const clean = (name: string, description: string) =>
    plugin({ key: `${name}@tools`, name, marketplace: 'tools', description });
  return [
    { ...egm!, enabled: true },
    warp!,
    sync!,
    clean('zephyr', 'Wind-down summaries at the end of a turn.'),
    clean('alpha-tools', 'Small helpers for everyday shell work.'),
    { ...clean('docs-helper', 'Writes and checks docs pages.'), enabled: true },
    clean('beta-notes', 'Collects meeting notes into Markdown.'),
    {
      ...clean('fresh-check', 'Just installed.'),
      scan: { status: 'pending', findings: [], agentReview: 'pending' },
    },
    clean('commit-coach', 'Suggests commit messages from the diff.'),
    {
      ...clean('lint-kit', 'Runs the project linters before a reply.'),
      enabled: true,
      scan: { ...warp!.scan },
    },
    clean('deploy-buddy', 'Explains deploy logs.'),
    clean('figma-bridge', 'Reads Figma frames for design work.'),
    clean('git-graph', 'Draws branch graphs in replies.'),
    clean('jira-lite', 'Looks up Jira tickets by key.'),
    clean('kanban', 'A tiny task board for a chat.'),
  ];
}

const MANY_ORDER = [
  'docs-helper',
  'egm',
  'lint-kit',
  'sync-helper',
  'warp',
  'alpha-tools',
  'beta-notes',
  'commit-coach',
  'deploy-buddy',
  'figma-bridge',
  'fresh-check',
  'git-graph',
  'jira-lite',
  'kanban',
  'zephyr',
];

test('turns a clean plugin on directly and a flagged one only after a hold', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const puts = await mockPlugins(page);
  await page.goto('/');
  const group = await openPlugins(page);
  await expect(group).toContainText('7 skills · 9 subagents');
  await expect(group).toContainText('1 hook');
  await expect(group).toContainText('2 commands · 1 hook · 1 MCP server');
  await expect(group.getByText('Clean', { exact: true })).toBeVisible();
  await expect(group.getByText('Review', { exact: true })).toBeVisible();
  await expect(group.getByText('Flagged', { exact: true })).toBeVisible();

  const egm = group.getByRole('switch', { name: 'egm', exact: true });
  await egm.focus();
  await expect(egm).toBeFocused();
  await page.keyboard.press('Space');
  await expect(egm).toBeChecked();
  expect(puts).toEqual([
    { key: 'egm@egm', body: { enabled: true, fingerprint: 'fp-egm@egm', confirmFindings: false } },
  ]);

  const flagged = group.getByRole('switch', { name: 'sync-helper', exact: true });
  await flagged.click();
  const confirm = group.getByRole('group', { name: 'Turn on sync-helper' });
  await expect(confirm).toContainText('3 findings');
  await expect(confirm).toContainText('Hooks run on your computer without asking each time.');
  await expect(confirm).toContainText('Inline shell commands in its skills run without asking.');
  const hold = confirm.getByRole('button', { name: 'Hold to turn on sync-helper' });
  await expect(hold).toBeFocused();
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(confirm).toContainText('Released early. Nothing happened.');
  expect(puts).toHaveLength(1);
  await expect(flagged).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(flagged).toBeFocused();
  await page.keyboard.press('Space');
  await expect(hold).toBeFocused();

  await page.keyboard.down('Space');
  await page.waitForTimeout(1_700);
  await page.keyboard.up('Space');
  await expect(flagged).toBeChecked();
  expect(puts[1]).toEqual({
    key: 'sync@tools',
    body: { enabled: true, fingerprint: 'fp-sync@tools', confirmFindings: true },
  });
});

test('shows a plugin’s hooks, servers and findings behind Details', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await mockPlugins(page);
  await page.goto('/');
  const group = await openPlugins(page);
  const row = group.getByRole('listitem').filter({ hasText: 'sync-helper' }).first();
  const details = row.getByRole('button', { name: 'Details' });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toContainText('curl -s https://sync.example/ping');
  await expect(row).toContainText('npx sync-mcp');
  await expect(row).toContainText('hooks/hooks.json:7');
  await expect(row).toContainText('bin/sync.js');
  await expect(row).toContainText('commands/pull.md:3');
  await expect(row).toContainText('Spark check');
  await expect(row).toContainText('Agent review');
  const panel = row.getByRole('region', { name: 'sync-helper details' });
  await expect(panel.locator('.plug-sum')).toHaveText(
    'Adds 2 commands. Runs 1 command automatically on Claude events, without asking. Its skills run 1 shell command without asking when they load. Starts its MCP server with each chat; tool calls follow the chat’s mode. Spark’s check flagged 1 thing. The agent review found 1 thing to check.',
  );
  const table = panel.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('cell', { name: 'commands/pull.md:3' })).toBeVisible();
});

test('Details reads at a glance for a plugin with many hooks and scripts', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [egm] = fixtures();
  await mockPlugins(page, [egm!, warpDetailsFixture()]);
  await page.goto('/');
  const group = await openPlugins(page);
  const row = group.getByRole('listitem').filter({ hasText: 'warp' }).first();
  await row.getByRole('button', { name: 'Details for warp' }).click();
  const panel = row.getByRole('region', { name: 'warp details' });
  await expect(panel.locator('.plug-sum')).toHaveText(
    'Runs 6 commands automatically on Claude events, without asking. The agent review found 2 things to check.',
  );
  await expect(panel.locator('h5')).toHaveText([
    'Agent review',
    'Runs automatically',
    'Other findings',
  ]);
  await expect(panel.locator('.plug-finding b')).toHaveText([
    'Sends parts of your chats to a helper script',
    'Writes unchecked text to your terminal',
  ]);
  await expect(panel).toContainText('transcript-content-exfil-to-notifier');
  await expect(panel.locator('.plug-rule-group b')).toHaveText('Scripts and programs it runs');
  await expect(panel).toContainText('scripts/on-stop.sh:18');
  const runs = panel.getByRole('table');
  await expect(runs.getByRole('row')).toHaveCount(7);
  const first = runs.getByRole('cell', { name: 'scripts/on-session-start.sh' });
  await expect(first).toHaveAttribute('title', '${CLAUDE_PLUGIN_ROOT}/scripts/on-session-start.sh');
  await expect(panel).not.toContainText('Hook on SessionStart');
  const more = panel.getByRole('button', { name: 'Show 6 more' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.plug-places li')).toHaveCount(3);
  await more.click();
  await expect(panel.locator('.plug-places li')).toHaveCount(9);
  await expect(panel.getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(panel.locator('.plug-foot')).toHaveText('Agent review · 26.8K tokens · $0.08');

  await row.getByRole('button', { name: 'Details for warp' }).click();
  await group.getByRole('button', { name: 'Details for egm' }).click();
  const egmPanel = group.getByRole('region', { name: 'egm details' });
  await expect(egmPanel.locator('.plug-sum')).toHaveText(
    'Adds 7 skills and 9 subagents. Nothing runs on its own.',
  );
  await expect(egmPanel).toContainText('No findings.');
  await expect(egmPanel).toContainText('/egm:egm-review');
});

test('a new Claude chat offers the commands of plugins that are on', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const plugins = fixtures().map((item) =>
    item.key === 'egm@egm' ? { ...item, enabled: true } : item,
  );
  await mockPlugins(page, plugins);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('/egm');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  await expect(menu.getByRole('option')).toHaveText([
    /\/egm:egm-draft/,
    /\/egm:egm-review/,
    /\/egm:egm-review-loop/,
  ]);
  await expect(menu.getByRole('option').first()).toContainText('From the egm plugin');
  await input.fill('/sync');
  await expect(menu.getByRole('option')).toHaveCount(0);
  await input.fill('/egm');
  if (SHOTS) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.slashpop').screenshot({ path: path.join(SHOTS, 'slash-menu.png') });
  }
  await input.fill('/nope now');
  await expect(page.getByText(/isn't a Spark or/)).toBeVisible();
  await input.fill('/egm:egm-review the design doc');
  await expect(page.getByText(/isn't a Spark or/)).toBeHidden();
});

test('a long plugin list sorts, filters and keeps its order while a switch flips', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await mockPlugins(page, manyFixtures());
  await page.goto('/');
  const group = await openPlugins(page);
  const names = group.locator('.plug-name b');
  const status = group.getByRole('status');
  await expect(names).toHaveText(MANY_ORDER);
  await expect(status).toHaveText('3 on · 15 installed · 3 need review');

  const coach = group.getByRole('switch', { name: 'commit-coach', exact: true });
  const reload = page.waitForResponse(
    (response) =>
      response.url().includes('/api/user-plugins') && response.request().method() === 'GET',
  );
  await coach.click();
  await expect(coach).toBeChecked();
  await reload;
  await expect(status).toHaveText('4 on · 15 installed · 3 need review');
  await expect(names).toHaveText(MANY_ORDER);

  const details = (name: string) =>
    group.getByRole('button', { name: `Details for ${name}`, exact: true });
  await details('warp').click();
  await details('egm').click();
  await expect(details('egm')).toHaveAttribute('aria-expanded', 'true');
  await expect(details('warp')).toHaveAttribute('aria-expanded', 'false');

  const filter = group.getByRole('searchbox', { name: 'Filter plugins' });
  await filter.fill('NOTES');
  await expect(names).toHaveText(['sync-helper', 'beta-notes']);
  await expect(status).toHaveText('4 on · 15 installed · 3 need review · 2 shown');
  await filter.fill('tools shell');
  await expect(names).toHaveText(['alpha-tools']);
  await filter.fill('nothing like this');
  await expect(names).toHaveCount(0);
  await expect(group.getByText('No plugins match “nothing like this”.')).toBeVisible();
  await filter.fill('');
  await expect(names.first()).toHaveText('commit-coach');
});

test('Plugins screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  await resetTestDatabase({ onboarded: true });
  await mockPlugins(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const group = await openPlugins(page);
    await expect(group.getByRole('switch', { name: 'egm', exact: true })).toBeVisible();
    await group.screenshot({ path: path.join(SHOTS, `plugins-${scheme}.png`) });
  }
  const group = page.getByRole('region', { name: 'Plugins' });
  const row = group.getByRole('listitem').filter({ hasText: 'sync-helper' }).first();
  await row.getByRole('button', { name: 'Details' }).click();
  await row.screenshot({ path: path.join(SHOTS, 'plugins-details.png') });
  await row.getByRole('button', { name: 'Details' }).click();
  await group.getByRole('switch', { name: 'sync-helper', exact: true }).click();
  await expect(group.getByRole('group', { name: 'Turn on sync-helper' })).toBeVisible();
  await row.screenshot({ path: path.join(SHOTS, 'plugins-flagged-confirm.png') });
});

function unclip(page: Page) {
  return page.getByRole('region', { name: 'Plugins' }).evaluate((element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      node.style.setProperty('overflow', 'visible', 'important');
      node.style.setProperty('height', 'auto', 'important');
      node.style.setProperty('max-height', 'none', 'important');
      if (getComputedStyle(node).position === 'fixed') node.style.position = 'absolute';
    }
  });
}

test('Details screenshots', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  await resetTestDatabase({ onboarded: true });
  const [egm] = fixtures();
  await mockPlugins(page, [egm!, warpDetailsFixture()]);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const group = await openPlugins(page);
    const row = group.getByRole('listitem').filter({ hasText: 'warp' }).first();
    await row.getByRole('button', { name: 'Details for warp' }).click();
    await unclip(page);
    await row.screenshot({ path: path.join(SHOTS, `details-v2-warp-${scheme}.png`) });
  }
  const group = page.getByRole('region', { name: 'Plugins' });
  await page.emulateMedia({ colorScheme: 'light' });
  await group.getByRole('button', { name: 'Details for egm' }).click();
  const row = group.getByRole('listitem').filter({ hasText: 'egm' }).first();
  await row.screenshot({ path: path.join(SHOTS, 'details-v2-egm.png') });
});

test('Plugins screenshots with 15 plugins', async ({ page }) => {
  test.skip(!SHOTS, 'Set SPARK_SHOTS to a folder to write the screenshots.');
  await resetTestDatabase({ onboarded: true });
  await mockPlugins(page, manyFixtures());
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const group = await openPlugins(page);
    await expect(group.locator('.plug-name b')).toHaveCount(15);
    await group.evaluate((element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        node.style.setProperty('overflow', 'visible', 'important');
        node.style.setProperty('height', 'auto', 'important');
        node.style.setProperty('max-height', 'none', 'important');
        if (getComputedStyle(node).position === 'fixed') node.style.position = 'absolute';
      }
    });
    await group.screenshot({ path: path.join(SHOTS, `plugins-15-${scheme}.png`) });
  }
  const group = page.getByRole('region', { name: 'Plugins' });
  await group.getByRole('searchbox', { name: 'Filter plugins' }).fill('notes');
  await expect(group.locator('.plug-name b')).toHaveCount(2);
  await group.screenshot({ path: path.join(SHOTS, 'plugins-15-filtered.png') });
});
