import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase, testDatabaseUrl } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

export const DEMO_NAME = 'Maya Chen';
export const DEMO_PROJECT = 'acme-web';
const SCHEMES = ['light', 'dark'] as const;

const DEMO_FILES: Record<string, string> = {
  'package.json': '{\n  "name": "acme-web",\n  "scripts": { "test": "vitest run" }\n}\n',
  'README.md': '# Acme web\n\nThe customer dashboard for Acme invoices.\n',
  'AGENTS.md': '# Agent notes\n\n- Run pnpm test before you finish.\n',
  'notes.txt': 'Release checklist\n- Update the changelog\n',
  'src/app.ts': "export { renderDashboard } from './dashboard.ts';\n",
  'src/dashboard.ts': 'export function renderDashboard() {\n  return "Invoices";\n}\n',
  'src/billing/invoice.ts': 'export const currency = "USD";\n',
};

export interface DemoRepo {
  root: string;
  remove(): void;
}

export function assertDemoDatabase(): void {
  const name = new URL(testDatabaseUrl()).pathname.slice(1);
  if (!name.includes('test')) {
    throw new Error(`Refusing to seed demo data into ${name}: it is not a test database.`);
  }
}

export function demoRepo(): DemoRepo {
  const base = realpathSync(mkdtempSync('/tmp/spark-docs-'));
  const root = path.join(base, DEMO_PROJECT);
  for (const [file, text] of Object.entries(DEMO_FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', [
      '-C',
      root,
      '-c',
      'user.email=maya@acme.test',
      '-c',
      'user.name=Maya',
      ...args,
    ]);
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'Acme web dashboard');
  return { root, remove: () => rmSync(base, { recursive: true, force: true }) };
}

interface DemoOptions {
  claudeMode?: string;
}

export async function seedDemo(
  page: Page,
  repo: DemoRepo,
  { claudeMode = 'auto' }: DemoOptions = {},
): Promise<void> {
  assertDemoDatabase();
  await resetTestDatabase({
    onboarded: true,
    connected: ['claude', 'codex'],
    jev: true,
    catalog: true,
  });
  const db = openTestDb();
  try {
    await db.query(`UPDATE profiles SET display_name = $1`, [DEMO_NAME]);
    await db.query(
      `UPDATE provider_connections SET model = 'opus[1m]', agent_mode = $1, effort = NULL
       WHERE provider = 'claude'`,
      [claudeMode],
    );
  } finally {
    await db.end();
  }
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  const { id: projectId } = (await response.json()) as { id: string };
  await seedChats([
    { title: 'Add CSV export to invoices', run: { status: 'succeeded' }, projectIds: [projectId] },
    {
      title: 'Why does the billing webhook retry?',
      run: { status: 'succeeded' },
      projectIds: [projectId],
      unread: true,
    },
    { title: 'Fix the login redirect loop', run: { status: 'succeeded' }, minutesAgo: 90 },
    { title: 'Explain the release checklist', run: { status: 'succeeded' }, minutesAgo: 240 },
  ]);
}

export async function useSystemTheme(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
}

export async function shoot(
  page: Page,
  folder: string,
  name: string,
  target?: Locator,
): Promise<void> {
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const file = path.join(folder, `${name}-${scheme}.png`);
    if (target) await target.screenshot({ path: file, animations: 'disabled' });
    else await page.screenshot({ path: file, animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}
