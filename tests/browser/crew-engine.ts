import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

export type Level = 'Hands-on' | 'Balanced' | 'Hands-off' | 'Full auto';

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

export async function crewChat(page: Page, repo: CrewRepo, level: Level): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  const name = path.basename(repo.root);
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText(name);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('radio', { name: /^Auto/ }).click();
  await expect(panel.getByRole('radio', { name: /^Auto/ })).toHaveAttribute('aria-checked', 'true');
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await panel.getByRole('radio', { name: /^Do/ }).click();
  const levels = panel.getByRole('radiogroup', { name: 'Involvement level' });
  await levels.getByRole('radio', { name: new RegExp(`^${level}`) }).click();
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText(`Do · ${level}`);
  await page.keyboard.press('Escape');
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
