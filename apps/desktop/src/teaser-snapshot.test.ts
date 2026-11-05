import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { digest, SECRET_PROJECT, SECRET_TITLE, teammates, today } from './teaser-fixtures.ts';
import {
  fetchTeaserSnapshot,
  readTeaserSnapshot,
  startTeaserSnapshots,
  teaserFile,
  writeTeaserSnapshot,
} from './teaser-snapshot.ts';

const NOW = new Date('2026-10-02T15:00:00.000Z');

const ROUTES: Record<string, unknown> = {
  '/api/runs/active': { activeRuns: 1 },
  '/api/home/today': today(),
  '/api/home/digest': digest(null),
  '/api/teammates': teammates([['Wren', 'needs_you']]),
};

function fakeApi(failing: string | null = null) {
  const seen: { route: string; token: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({
      route: url.pathname,
      token: new Headers(init?.headers).get(API_TOKEN_HEADER),
    });
    if (url.pathname === failing) return new Response('nope', { status: 500 });
    return Response.json(ROUTES[url.pathname]);
  }) as typeof fetch;
  return { seen, source: { origin: 'http://127.0.0.1:4100', token: 'launch-token', fetchImpl } };
}

const tempFile = async () => teaserFile(await mkdtemp(path.join(tmpdir(), 'spark-boot-teasers-')));

describe('teaser snapshot file', () => {
  it('saves only counts and names from the API, with the launch token', async () => {
    const api = fakeApi();
    const file = await tempFile();
    await startTeaserSnapshots(api.source, file, () => undefined).saveNow();

    const saved = await readFile(file, 'utf8');
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual([
      'briefAt',
      'busy',
      'needsYou',
      'prs',
      'running',
      'savedAt',
      'waiting',
    ]);
    expect(saved).not.toContain(SECRET_TITLE);
    expect(saved).not.toContain(SECRET_PROJECT);
    expect(await readTeaserSnapshot(file)).toMatchObject({
      running: 1,
      needsYou: 1,
      prs: 2,
      waiting: ['Wren'],
    });
    expect(api.seen.map((call) => call.route).sort()).toEqual(Object.keys(ROUTES).sort());
    expect(api.seen.every((call) => call.token === 'launch-token')).toBe(true);
  });

  it('keeps the last snapshot when the API cannot answer', async () => {
    const file = await tempFile();
    const earlier = await fetchTeaserSnapshot(fakeApi().source, NOW);
    if (!earlier) throw new Error('expected a snapshot');
    await writeTeaserSnapshot(file, earlier);

    expect(await fetchTeaserSnapshot(fakeApi('/api/teammates').source, NOW)).toBeNull();
    await startTeaserSnapshots(fakeApi('/api/home/today').source, file, () => undefined).saveNow();
    expect(await readTeaserSnapshot(file)).toEqual(earlier);
  });

  it('reads a missing, damaged or widened file as no snapshot', async () => {
    const file = await tempFile();
    expect(await readTeaserSnapshot(file)).toBeNull();
    await writeFile(file, '{ not json');
    expect(await readTeaserSnapshot(file)).toBeNull();
    const snapshot = await fetchTeaserSnapshot(fakeApi().source, NOW);
    await writeFile(file, JSON.stringify({ ...snapshot, title: SECRET_TITLE }));
    expect(await readTeaserSnapshot(file)).toBeNull();
  });
});
