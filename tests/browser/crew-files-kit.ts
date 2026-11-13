import { expect, type Page, type Route } from '@playwright/test';
import {
  parseSkillFile,
  saveCrewFileSchema,
  skillOfPath,
} from '../../packages/contracts/src/crew-files.ts';

interface StoredFile {
  text: string;
  hash: string;
}

export interface FakeCrewFiles {
  saves: { sparkId: string; path: string; baseHash: string | null }[];
  put: (sparkId: string, path: string, text: string) => void;
  text: (sparkId: string, path: string) => string | undefined;
  paths: (sparkId: string) => string[];
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function isSkillFile(path: string): boolean {
  return skillOfPath(path) !== null && path.split('/').length === 3 && path.endsWith('/SKILL.md');
}

export async function fakeCrewFiles(page: Page): Promise<FakeCrewFiles> {
  const folders = new Map<string, Map<string, StoredFile>>();
  let version = 0;
  const folderOf = (sparkId: string) => {
    const folder = folders.get(sparkId) ?? new Map<string, StoredFile>();
    folders.set(sparkId, folder);
    return folder;
  };
  const api: FakeCrewFiles = {
    saves: [],
    put: (sparkId, path, text) => {
      version += 1;
      folderOf(sparkId).set(path, { text, hash: `hash-${version}` });
    },
    text: (sparkId, path) => folderOf(sparkId).get(path)?.text,
    paths: (sparkId) => [...folderOf(sparkId).keys()].sort(),
  };
  const sparkOf = (route: Route) => new URL(route.request().url()).pathname.split('/').at(-2)!;

  await page.route('**/api/teammates/*/folder', async (route) => {
    const sparkId = sparkOf(route);
    const entries = [...folderOf(sparkId).entries()];
    const parsed = entries
      .filter(([path]) => isSkillFile(path))
      .map(([path, file]) => ({ path, result: parseSkillFile(file.text) }));
    await json(route, 200, {
      sparkId,
      files: entries.map(([path, file]) => ({ path, bytes: Buffer.byteLength(file.text) })),
      skills: parsed.flatMap(({ result }) => (result.skill ? [result.skill] : [])),
      problems: parsed.flatMap(({ path, result }) =>
        result.problem ? [{ path, text: result.problem }] : [],
      ),
    });
  });
  await page.route('**/api/teammates/*/files**', async (route) => {
    const request = route.request();
    const sparkId = sparkOf(route);
    const folder = folderOf(sparkId);
    if (request.method() === 'PUT') {
      const body = saveCrewFileSchema.parse(request.postDataJSON());
      api.saves.push({ sparkId, path: body.path, baseHash: body.baseHash });
      const stored = folder.get(body.path);
      if ((stored?.hash ?? null) !== body.baseHash) {
        return json(route, 409, { error: 'This file changed since it was opened.' });
      }
      api.put(sparkId, body.path, body.text);
      return json(route, 200, { path: body.path, ...folder.get(body.path)! });
    }
    const path = new URL(request.url()).searchParams.get('path') ?? '';
    const stored = folder.get(path);
    if (!stored) return json(route, 404, { error: 'That file no longer exists.' });
    if (request.method() === 'DELETE') {
      folder.delete(path);
      return route.fulfill({ status: 204 });
    }
    return json(route, 200, { path, ...stored });
  });
  return api;
}

export async function addSpark(page: Page, data: Record<string, unknown>): Promise<string> {
  const response = await page.request.post('/api/teammates', { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

export async function openSparksPage(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Sparks/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sparks' })).toBeVisible();
}

export const SKILL_TEXT = `---
name: dependency-audit
description: Check changed dependencies for known vulnerabilities.
---

Use this when package.json or a lockfile changed.
`;
