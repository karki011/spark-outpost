import { fetchFresh } from './fresh-fetch.ts';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { ConversationDetail } from '../../packages/contracts/src/conversations.ts';
import {
  BUILD_REQUEST,
  chatRepo,
  type ChatRepo,
  projectChat,
  resetWithAgents,
  send,
  turnDone,
} from './project-chat-kit.ts';
import { useSystemTheme } from './docs-seed.ts';
import { rail } from './chat-rail-kit.ts';

const SHOTS = process.env.RAIL_SHOTS ?? 'test-results/chat-rail-lines';

const names = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

const CONNECTORS = [
  { id: 'github', state: 'on' },
  { id: 'jira', state: 'on' },
  { id: 'confluence', state: 'on' },
  { id: 'slack', state: 'switch_off' },
  { id: 'calendar', state: 'on' },
  { id: 'linear', state: 'not_connected' },
  { id: 'servicenow', state: 'not_connected' },
];

function plugin(name: string, extra: Record<string, unknown>) {
  return {
    key: `${name}@market`,
    name,
    marketplace: 'market',
    version: '1.0.0',
    description: name,
    skills: 1,
    commands: 0,
    agents: 0,
    commandNames: [],
    hooks: [],
    mcpServers: [],
    loadable: true,
    unloadableReason: null,
    fingerprint: `${name}-1`,
    scan: { status: 'clean', findings: [], agentReview: 'off' },
    enabled: true,
    changed: false,
    ...extra,
  };
}

const PLUGINS = [
  plugin('atlassian', {
    skills: 12,
    mcpServers: [{ name: 'atlassian', command: 'npx', args: [], url: null }],
  }),
  plugin('egm', { skills: 7, agents: 9 }),
  plugin('gorkhali', { commands: 8, agents: 5, enabled: false }),
  plugin('typesafe', {}),
];

function server(name: string, id: string) {
  return {
    kind: 'user',
    id,
    name,
    source: 'user',
    transport: 'stdio',
    fingerprint: `${name}-f`,
    enabled: true,
    via: 'global',
    changed: false,
    check: null,
  };
}

const SERVERS = [
  server('Amplitude', '11111111-1111-4111-8111-111111111111'),
  { ...server('jira', '22222222-2222-4222-8222-222222222222'), enabled: false, via: 'off' },
];

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function richTools(page: Page) {
  await page.route('**/api/agent-connectors', (route) => json(route, { connectors: CONNECTORS }));
  await page.route('**/api/user-plugins', (route) =>
    route.request().method() === 'GET' ? json(route, { plugins: PLUGINS }) : route.continue(),
  );
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}\/mcp$/, (route) =>
    json(route, { servers: SERVERS }),
  );
  await page.route(/\/api\/projects\/[0-9a-f-]{36}\/agent-config$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const config = await response.json();
    const item = (name: string) => ({ name, description: '', path: `.claude/x/${name}` });
    await route.fulfill({
      response,
      json: {
        ...config,
        skills: names('skill', 14).map(item),
        subagents: names('reviewer', 32).map(item),
        instructions: ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', ...names('docs/rule', 13)].map(
          (file) => ({ path: file, bytes: 10, nested: false }),
        ),
      },
    });
  });
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await fetchFresh(route);
    const detail = (await response.json()) as ConversationDetail;
    const runs = detail.runs.map((run) =>
      run.parentRunId ? run : { ...run, following: ['CLAUDE.md', 'AGENTS.md'] },
    );
    const usageTotals = { ...detail.usageTotals, totalTokens: 8_100_000, costUsd: 14.47 };
    await route.fulfill({ response, json: { ...detail, runs, usageTotals } });
  });
}

let repo: ChatRepo | null = null;

test.afterEach(() => {
  repo?.remove();
  repo = null;
});

async function shoot(page: Page, name: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await rail(page).screenshot({ path: `${SHOTS}/rail-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('every row in the context rail is one line, and tool groups open in place', async ({
  page,
}) => {
  test.setTimeout(150_000);
  mkdirSync(SHOTS, { recursive: true });
  await resetWithAgents();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 2000, height: 1400 });
  repo = chatRepo();
  await projectChat(page, repo, 'Full auto');
  await send(page, `${BUILD_REQUEST} #build`);
  await turnDone(page, 120_000);
  await richTools(page);
  await page.reload();
  const rows = rail(page).getByRole('list', { name: 'This chat' });
  await expect(rows.locator('[data-row="usage"] .crail-main')).toHaveText('$14.47');
  await expect(rows.locator('[data-row="following"] .crail-main')).toHaveText('Following 2');
  await expect(rows.locator('[data-row="following"] .crail-detail')).toHaveText('CLAUDE.md');
  await expect(rows.locator('[data-row="agent"] .crail-main')).not.toContainText('Claude');
  await expect(rows.getByRole('button', { name: /^Project .+ · worktree$/ })).toBeVisible();
  await expect(rows.locator('[data-row="project"] .crail-detail')).not.toContainText('worktree');
  const lines = await rows.locator('[data-row]').evaluateAll((items) =>
    items.map((item) => {
      const main = item.querySelector('.crail-main')!;
      return {
        row: item.getAttribute('data-row'),
        height: item.getBoundingClientRect().height,
        mainCut: main.scrollWidth > main.clientWidth,
      };
    }),
  );
  for (const line of lines) {
    expect(line.height, line.row ?? '').toBeLessThanOrEqual(30);
    expect(line.mainCut, line.row ?? '').toBe(false);
  }
  await page.evaluate(() => document.fonts.ready);
  await shoot(page, 'closed');

  const tools = rail(page).getByRole('region', { name: 'Tools' });
  const note = tools.getByText('Changes apply to the next message.');
  await expect(note).toBeHidden();
  const mcp = tools.getByRole('button', { name: /^MCP servers/ });
  await expect(mcp).toHaveAttribute('aria-expanded', 'false');
  await expect(mcp).toContainText('1 of 2 on');
  await expect(tools.getByRole('button', { name: /^Claude plugins/ })).toContainText('3 on');
  await expect(tools.getByRole('switch', { name: 'Use jira in this chat' })).toHaveCount(0);
  await mcp.press('Enter');
  await expect(mcp).toHaveAttribute('aria-expanded', 'true');
  await expect(note).toBeVisible();
  const jira = tools.getByRole('switch', { name: 'Use jira in this chat' });
  await expect(jira).toHaveAttribute('aria-checked', 'false');
  const jiraRow = tools
    .getByRole('listitem')
    .filter({ has: page.getByRole('switch', { name: 'Use jira in this chat' }) });
  await expect(jiraRow.getByText('Off', { exact: true })).toBeVisible();
  const amplitudeRow = tools
    .getByRole('listitem')
    .filter({ has: page.getByRole('switch', { name: 'Use Amplitude in this chat' }) });
  const tip = amplitudeRow.locator('small');
  await expect(tip).toBeHidden();
  const closedHeight = (await amplitudeRow.boundingBox())!.height;
  await amplitudeRow.hover();
  await expect(tip).toBeVisible();
  const tipBox = (await tip.boundingBox())!;
  const rowBox = (await amplitudeRow.boundingBox())!;
  expect(rowBox.height).toBeGreaterThan(closedHeight);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
  await page.mouse.move(0, 0);

  await tools.getByRole('button', { name: /^Claude plugins/ }).click();
  await tools.getByRole('button', { name: /^Connectors/ }).click();
  await shoot(page, 'open');

  await page.reload();
  await expect(rail(page).getByRole('button', { name: /^MCP servers/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
