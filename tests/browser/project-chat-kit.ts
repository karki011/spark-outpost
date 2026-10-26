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
import { expect, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { pickerPanel, pickPermission, type Level } from './permissions-kit.ts';

export const BUILD_REQUEST = 'Move date handling into one module and update every component';

export interface ChatRepo {
  root: string;
  work(): string;
  notes(): string;
  file(relative: string): string;
  commit(relative: string, text: string): void;
  remove(): void;
}

function chatFolder(root: string): string {
  const copies = path.join(root, '.spark', 'worktrees');
  if (!existsSync(copies)) return root;
  const newest = readdirSync(copies)
    .map((name) => path.join(copies, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ?? root;
}

export function chatRepo(): ChatRepo {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-chat-')));
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

export async function resetWithAgents(): Promise<void> {
  await resetTestDatabase({
    onboarded: true,
    connected: ['claude', 'codex'],
    jev: true,
    catalog: true,
  });
}

export async function linkedChat(page: Page, repo: ChatRepo): Promise<void> {
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

export async function projectChat(page: Page, repo: ChatRepo, level: Level): Promise<void> {
  await linkedChat(page, repo);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = pickerPanel(page);
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await pickPermission(page, level);
  await page.keyboard.press('Escape');
}

export async function send(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await expect(page.getByRole('button', { name: /^(Send|Send now|Queue message)$/ })).toBeEnabled();
  await input.press('Enter');
}

export const card = (page: Page, name: RegExp) => page.getByRole('group', { name });

export const keptResult = (page: Page) => page.getByRole('region', { name: /^Kept · / });

export const turnMood = (page: Page): Locator => page.locator('.msg.ai .mood').last();

export async function turnDone(page: Page, timeout = 30_000): Promise<void> {
  await expect(turnMood(page)).toHaveText('done', { timeout });
}

export async function allowEdit(page: Page): Promise<void> {
  const edit = card(page, /^Edit .+\?$/).filter({
    has: page.getByRole('button', { name: 'Deny' }),
  });
  await edit.getByRole('button', { name: 'Allow', exact: true }).click();
}
