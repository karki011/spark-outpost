import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

export type Level = 'Ask before edits' | 'Review keep' | 'Auto-edit' | 'Full auto';

export const CREW_REQUEST = 'Move date handling into one module and update every component';

export interface CrewRepo {
  root: string;
  notes(): string;
  file(relative: string): string;
  remove(): void;
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
    notes: () => readFileSync(path.join(root, 'notes.txt'), 'utf8'),
    file: (relative) => readFileSync(path.join(root, relative), 'utf8'),
    remove: () => rmSync(root, { recursive: true, force: true }),
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
    'Ask before edits': { mode: 'Manual', autonomy: 'Review each step' },
    'Review keep': { mode: 'Accept edits', autonomy: 'Review each step' },
    'Auto-edit': { mode: 'Accept edits', autonomy: 'Automatic' },
    'Full auto': { mode: 'Bypass permissions', autonomy: 'Full auto → PR' },
  },
  codex: {
    Ask: { mode: 'Read-only', autonomy: null },
    'Ask before edits': { mode: 'Ask every time', autonomy: 'Review each step' },
    'Review keep': { mode: 'Approve for me', autonomy: 'Review each step' },
    'Auto-edit': { mode: 'Approve for me', autonomy: 'Automatic' },
    'Full auto': { mode: 'Approve for me', autonomy: 'Full auto → PR' },
  },
};

export function accessLabel(permission: Permission, provider: 'claude' | 'codex' = 'claude') {
  const { mode, autonomy } = ACCESS[provider][permission];
  return autonomy ? `${mode} · ${autonomy}` : mode;
}

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

export async function pickAutonomy(page: Page, autonomy: string): Promise<void> {
  const levels = pickerPanel(page).getByRole('radiogroup', { name: 'Harness autonomy' });
  await levels.getByRole('radio', { name: autonomy, exact: true }).click();
  await expect(levels.getByRole('radio', { name: autonomy, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

export async function pickPermission(
  page: Page,
  permission: Permission,
  provider: 'claude' | 'codex' = 'claude',
): Promise<void> {
  const panel = pickerPanel(page);
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  const { mode, autonomy } = ACCESS[provider][permission];
  await pickMode(page, mode);
  if (autonomy) await pickAutonomy(page, autonomy);
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText(
    accessLabel(permission, provider),
  );
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
