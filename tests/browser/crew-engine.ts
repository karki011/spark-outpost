import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

export type Level = 'Ask before edits' | 'Auto-edit' | 'Full auto';

export const CREW_REQUEST = 'Move date handling into one module and update every component';

export interface CrewRepo {
  root: string;
  work(): string;
  notes(): string;
  file(relative: string): string;
  commit(relative: string, text: string): void;
  remove(): void;
}

export function chatFolder(root: string): string {
  const copies = path.join(root, '.spark', 'worktrees');
  if (!existsSync(copies)) return root;
  const newest = readdirSync(copies)
    .map((name) => path.join(copies, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ?? root;
}

export function crewRepo(): CrewRepo {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-crew-')));
  writeFileSync(path.join(root, 'notes.txt'), 'start\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  return {
    root,
    work: () => chatFolder(root),
    notes: () => readFileSync(path.join(chatFolder(root), 'notes.txt'), 'utf8'),
    file: (relative) => readFileSync(path.join(chatFolder(root), relative), 'utf8'),
    commit: (relative, text) => {
      writeFileSync(path.join(root, relative), text);
      git('add', relative);
      git('commit', '-qm', `add ${relative}`);
    },
    remove: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

export async function resetCrew(): Promise<void> {
  await resetTestDatabase({
    onboarded: true,
    connected: ['claude', 'codex'],
    jev: true,
    catalog: true,
  });
}

export async function autoContinueAfter(page: Page, seconds: number | null): Promise<void> {
  const response = await page.request.patch('/api/profile', {
    data: { autoContinueSeconds: seconds },
  });
  expect(response.ok()).toBe(true);
}

export async function linkedChat(page: Page, repo: CrewRepo): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  const name = path.basename(repo.root);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText(name);
  await page.keyboard.press('Escape');
}

export async function failingCheck(page: Page, root: string): Promise<void> {
  const command = `${process.execPath} -e 'process.exit(require("fs").readFileSync("notes.txt","utf8").includes("step")?1:0)'`;
  const listed = await page.request.get('/api/projects');
  const project = ((await listed.json()) as { id: string; rootPath: string }[]).find(
    (candidate) => candidate.rootPath === root,
  );
  expect(project).toBeDefined();
  const saved = await page.request.patch(`/api/projects/${project!.id}`, {
    data: { checkCommands: [command], commandAllowlist: [command] },
  });
  expect(saved.ok()).toBe(true);
}

export async function crewChat(page: Page, repo: CrewRepo, level: Level): Promise<void> {
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('radio', { name: /^Auto/ }).click();
  await expect(panel.getByRole('radio', { name: /^Auto/ })).toHaveAttribute('aria-checked', 'true');
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await pickPermission(page, level);
  await page.keyboard.press('Escape');
}

export type Permission = 'Ask' | Level;

interface Access {
  mode: string;
  autonomy: string | null;
}

const ACCESS: Record<'claude' | 'codex', Record<Permission, Access>> = {
  claude: {
    Ask: { mode: 'Plan', autonomy: null },
    'Ask before edits': { mode: 'Manual', autonomy: 'Automatic' },
    'Auto-edit': { mode: 'Accept edits', autonomy: 'Automatic' },
    'Full auto': { mode: 'Bypass permissions', autonomy: 'Full auto → PR' },
  },
  codex: {
    Ask: { mode: 'Read-only', autonomy: null },
    'Ask before edits': { mode: 'Ask every time', autonomy: 'Automatic' },
    'Auto-edit': { mode: 'Approve for me', autonomy: 'Automatic' },
    'Full auto': { mode: 'Approve for me', autonomy: 'Full auto → PR' },
  },
};

export const pickerPanel = (page: Page) =>
  page.getByRole('dialog', { name: 'Model, effort, and permissions' });

export async function pickMode(page: Page, mode: string): Promise<void> {
  const modes = pickerPanel(page).getByRole('radiogroup', { name: 'Agent mode' });
  await modes.getByRole('radio', { name: mode, exact: true }).click();
  await expect(modes.getByRole('radio', { name: mode, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

export const permissionChip = (page: Page) => page.getByRole('button', { name: /^Permissions: / });

export const autonomyChip = (page: Page) => page.getByRole('button', { name: /^Spark autonomy: / });

export const workPanel = (page: Page) => page.locator('#work-panel');

export async function pickAutonomy(page: Page, autonomy: string): Promise<void> {
  if (await pickerPanel(page).isVisible()) await page.keyboard.press('Escape');
  await expect(pickerPanel(page)).toBeHidden();
  const current = await autonomyChip(page).getAttribute('aria-label');
  if (current === `Spark autonomy: ${autonomy}`) return;
  const panel = workPanel(page);
  const wasOpen = await panel.evaluate((element) => element.classList.contains('on'));
  await autonomyChip(page).click();
  const levels = panel.getByRole('radiogroup', { name: 'Spark autonomy' });
  const choice = levels.getByRole('radio', { name: autonomy, exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await expect(autonomyChip(page)).toHaveAccessibleName(`Spark autonomy: ${autonomy}`);
  if (!wasOpen) {
    await panel.getByRole('button', { name: 'Hide work panel' }).click();
    await expect(panel).not.toHaveClass(/\bon\b/);
  }
}

export async function pickPermission(
  page: Page,
  permission: Permission,
  provider: 'claude' | 'codex' = 'claude',
): Promise<void> {
  const { mode, autonomy } = ACCESS[provider][permission];
  if (autonomy) {
    await pickAutonomy(page, autonomy);
    await page.getByRole('button', { name: /^Model and effort/ }).click();
  }
  const panel = pickerPanel(page);
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await pickMode(page, mode);
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText(mode);
}

export async function send(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

export const card = (page: Page, name: RegExp) => page.getByRole('group', { name });

export function agentHead(page: Page, name: string) {
  return page
    .locator('.crew-turn .agent-head, .crew-turn .agent-fold')
    .filter({ has: page.locator('.agent-name', { hasText: new RegExp(`^${name}$`) }) });
}

export function agentBlock(page: Page, name: string) {
  return page
    .locator('.crew-turn .agent-block')
    .filter({ has: page.locator('.agent-name', { hasText: new RegExp(`^${name}$`) }) });
}

export async function allowEdit(page: Page): Promise<void> {
  const edit = card(page, /Change a file\?/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await edit.getByRole('button', { name: 'Allow', exact: true }).click();
}
