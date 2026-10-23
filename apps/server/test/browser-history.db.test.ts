import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserHistoryEvent } from '@spark-outpost/contracts';
import { clearHistory, recordHistory, searchHistory } from '../src/persistence/browser-history.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function visit(change: Partial<BrowserHistoryEvent> = {}): BrowserHistoryEvent {
  return {
    kind: 'visit',
    profile: 'personal',
    url: 'https://docs.example.com/deploy',
    title: '',
    ...change,
  };
}

const search = (profile: 'personal' | 'work', q = '') =>
  searchHistory(t.db, t.workspaceId, { profile, q, limit: 8 });

async function age(url: string, hours: number) {
  await t.db.query(
    `UPDATE browser_history SET last_visited_at = now() - make_interval(hours => $2)
     WHERE url = $1`,
    [url, hours],
  );
}

describe('browser history', () => {
  it('counts a repeated visit on one row and keeps the last real title', async () => {
    await recordHistory(t.db, t.workspaceId, visit());
    await recordHistory(t.db, t.workspaceId, visit({ kind: 'title', title: 'Deploying' }));
    await recordHistory(t.db, t.workspaceId, visit());
    const [entry, ...rest] = await search('personal');
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ title: 'Deploying', visitCount: 2 });
  });

  it('keeps Personal and Work apart', async () => {
    await recordHistory(t.db, t.workspaceId, visit({ title: 'Mine' }));
    await recordHistory(t.db, t.workspaceId, visit({ profile: 'work', title: 'Shared' }));
    expect((await search('personal')).map((entry) => entry.title)).toEqual(['Mine']);
    expect((await search('work')).map((entry) => entry.title)).toEqual(['Shared']);
    await clearHistory(t.db, t.workspaceId, 'work', null);
    expect(await search('work')).toEqual([]);
    expect(await search('personal')).toHaveLength(1);
  });

  it('finds by title or address, treating % and _ as plain text', async () => {
    await recordHistory(t.db, t.workspaceId, visit({ title: 'Deploy previews' }));
    await recordHistory(
      t.db,
      t.workspaceId,
      visit({ url: 'https://blog.example.org/100%_uptime', title: 'Uptime' }),
    );
    expect((await search('personal', 'previews')).map((entry) => entry.title)).toEqual([
      'Deploy previews',
    ]);
    expect((await search('personal', 'blog.example')).map((entry) => entry.title)).toEqual([
      'Uptime',
    ]);
    expect((await search('personal', '%_')).map((entry) => entry.title)).toEqual(['Uptime']);
    expect(await search('personal', '_x')).toEqual([]);
  });

  it('clears a time range and leaves older visits', async () => {
    await recordHistory(t.db, t.workspaceId, visit({ url: 'https://a.example/' }));
    await recordHistory(t.db, t.workspaceId, visit({ url: 'https://b.example/' }));
    await age('https://b.example/', 30);
    const removed = await clearHistory(
      t.db,
      t.workspaceId,
      null,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    expect(removed).toBe(1);
    expect((await search('personal')).map((entry) => entry.url)).toEqual(['https://b.example/']);
  });

  it('never brings back a cleared page when its title arrives late', async () => {
    await recordHistory(t.db, t.workspaceId, visit());
    await clearHistory(t.db, t.workspaceId, null, null);
    await recordHistory(t.db, t.workspaceId, visit({ kind: 'title', title: 'Late title' }));
    expect(await search('personal')).toEqual([]);
  });

  it('takes only web addresses with secrets hidden, and clears through the API', async () => {
    const api = localClient(createTestApp(t));
    const secret = await api.send('post', '/api/browser-history', {
      ...visit(),
      url: 'https://app.example.com/callback?code=abc',
    });
    expect(secret.status).toBe(400);
    const file = await api.send('post', '/api/browser-history', {
      ...visit(),
      url: 'file:///etc/hosts',
    });
    expect(file.status).toBe(400);
    expect((await api.send('post', '/api/browser-history', visit())).status).toBe(204);
    const listed = await api.get('/api/browser-history?profile=personal&q=deploy');
    expect(listed.body.entries).toHaveLength(1);
    const cleared = await api.send('post', '/api/browser-history/clear', {
      profile: null,
      range: 'all',
    });
    expect(cleared.body).toEqual({ removed: 1 });
  });
});
