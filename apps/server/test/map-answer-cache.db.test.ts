import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IntakeQuestions } from '../src/advisor/intake-questions.ts';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import {
  ANSWER_CACHE_TTL_DAYS,
  answerCacheKey,
  cachedAnswers,
  storeAnswers,
} from '../src/map/answer-cache.ts';
import { labelQuestions } from '../src/map/label-questions.ts';
import { LABEL_GIVE_UP_AFTER } from '../src/map/policy.ts';
import { queueRepo } from '../src/map/store.ts';
import { jsonResponse } from './app-support.ts';
import {
  addProject,
  connectJev,
  fakeJev,
  mapBuilder,
  writeFiles,
  writeRepo,
} from './map-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  'server/orders.ts': "import { money } from '../shared/money';\nexport const orders = money(1);\n",
  'shared/money.ts': 'export function money(value: number) { return value.toFixed(2); }\n',
};

const asked: IntakeQuestions = labelQuestions({ root: 'shared' }, 'evidence', ['Shared', 'Money']);
const answer = (choice: string) => ({
  type: 'choice' as const,
  choice,
  probabilities: { [choice]: 0.9 },
  confidence: 0.9,
});
const response = {
  model: 'jev-1.13.0',
  answers: { category: answer('shared'), kind: answer('domain'), name: answer('Money') },
};

let t: TestDb;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(FILES);
  await addProject(t, root);
  await connectJev(t);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

async function relabel(builder: { runOnce(): Promise<boolean> }) {
  await t.db.query('DELETE FROM map_labels');
  const { rows } = await t.db.query<{ id: string }>('SELECT id FROM map_repos');
  await queueRepo(t.db, rows[0]!.id, `forced-${Date.now()}`);
  expect(await builder.runOnce()).toBe(true);
}

async function calls() {
  const { rows } = await t.db.query<{
    subject: string;
    from_cache: boolean;
    input_tokens: number | null;
    cost_usd: string | null;
    model: string | null;
    jev_status: string;
  }>(
    `SELECT subject, from_cache, input_tokens, cost_usd, model, jev_status
     FROM map_jev_calls ORDER BY created_at, subject`,
  );
  return rows;
}

describe('answer cache store', () => {
  const key = answerCacheKey('map-label-1', 'jev-1.13.0', asked);

  it('returns stored answers for the same key and nothing for another', async () => {
    expect(await cachedAnswers(t.db, key, asked)).toBeNull();
    await storeAnswers(t.db, key, response);
    expect(await cachedAnswers(t.db, key, asked)).toEqual(response);
    const { rows } = await t.db.query('SELECT * FROM jev_answer_cache');
    expect(Object.keys(rows[0] as object).sort()).toEqual([
      'answers',
      'created_at',
      'key',
      'model',
    ]);
    expect(JSON.stringify(rows)).not.toContain('evidence');
  });

  it('changes the key with the policy version, the model and any part of the request', () => {
    const other = labelQuestions({ root: 'shared' }, 'evidence changed', ['Shared', 'Money']);
    const keys = new Set([
      key,
      answerCacheKey('map-label-2', 'jev-1.13.0', asked),
      answerCacheKey('map-label-1', 'jev-1.14.0', asked),
      answerCacheKey('map-label-1', 'jev-1.13.0', other),
    ]);
    expect(keys.size).toBe(4);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(answerCacheKey('map-label-1', 'jev-1.13.0', asked)).toBe(key);
  });

  it('ignores a corrupt row and a row that misses an asked question', async () => {
    await storeAnswers(t.db, key, response);
    await t.db.query(`UPDATE jev_answer_cache SET answers = '{"category": "core"}'`);
    expect(await cachedAnswers(t.db, key, asked)).toBeNull();
    await t.db.query(`UPDATE jev_answer_cache SET answers = '[1, 2]'`);
    expect(await cachedAnswers(t.db, key, asked)).toBeNull();
    await storeAnswers(t.db, key, { ...response, answers: { category: answer('core') } });
    expect(await cachedAnswers(t.db, key, asked)).toBeNull();
  });

  it('expires answers after the TTL and prunes them on the next write', async () => {
    await storeAnswers(t.db, key, response);
    await t.db.query(
      `UPDATE jev_answer_cache SET created_at = now() - make_interval(days => $1, mins => 1)`,
      [ANSWER_CACHE_TTL_DAYS],
    );
    expect(await cachedAnswers(t.db, key, asked)).toBeNull();
    await storeAnswers(t.db, answerCacheKey('map-label-1', 'jev-1.13.0', { ...asked, state: {} }), {
      ...response,
    });
    const { rows } = await t.db.query<{ key: string }>('SELECT key FROM jev_answer_cache');
    expect(rows.map((row) => row.key)).not.toContain(key);
    expect(rows).toHaveLength(1);
  });
});

describe('map labels with the answer cache', () => {
  it('asks Jev once and answers unchanged areas from the cache on a rebuild', async () => {
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    expect(await builder.runOnce()).toBe(true);
    const first = jev.requests.length;
    expect(first).toBeGreaterThan(0);
    expect((await calls()).every((call) => !call.from_cache && call.input_tokens === 1000)).toBe(
      true,
    );

    await relabel(builder);
    await scanner.idle();

    expect(jev.requests).toHaveLength(first);
    const cached = (await calls()).filter((call) => call.from_cache);
    expect(cached).toHaveLength(first);
    expect(cached.every((call) => call.input_tokens === 0 && Number(call.cost_usd) === 0)).toBe(
      true,
    );
    expect(
      cached.every((call) => call.model === 'jev-1.13.0' && call.jev_status === 'answered'),
    ).toBe(true);
    const labels = await t.db.query<{ source: string }>('SELECT source FROM map_labels');
    expect(labels.rows.every((row) => row.source === 'jev')).toBe(true);
    const timings = await t.db.query<{ timings: Record<string, number> }>(
      'SELECT timings FROM map_repos',
    );
    expect(timings.rows[0]?.timings).toMatchObject({
      jevCalls: 0,
      jevCached: first,
      jevInputTokens: 0,
    });
  });

  it('asks again only for the area whose evidence changed', async () => {
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    await builder.runOnce();
    const first = jev.requests.length;
    await writeFiles(root, {
      'shared/money.ts': 'export function money(value: number) { return value.toFixed(3); }\n',
    });

    await relabel(builder);
    await scanner.idle();

    expect(jev.requests).toHaveLength(first + 1);
    expect(JSON.stringify(jev.requests.at(-1))).toContain('toFixed(3)');
  });

  it('asks again when the cached answers are corrupt', async () => {
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    await builder.runOnce();
    const first = jev.requests.length;
    await t.db.query(`UPDATE jev_answer_cache SET answers = '"broken"'`);

    await relabel(builder);
    await scanner.idle();

    expect(jev.requests).toHaveLength(first * 2);
    expect((await calls()).some((call) => call.from_cache)).toBe(false);
  });
});

describe('map labels without Jev', () => {
  async function outcome() {
    const repos = await t.db.query<{ status: string; error: string | null }>(
      'SELECT status, error FROM map_repos',
    );
    const labels = await t.db.query<{ source: string }>('SELECT source FROM map_labels');
    const cache = await t.db.query('SELECT 1 FROM jev_answer_cache');
    return {
      repo: repos.rows[0],
      sources: [...new Set(labels.rows.map((row) => row.source))],
      labels: labels.rows.length,
      cached: cache.rowCount,
      calls: await calls(),
    };
  }

  it('builds with rule labels and touches neither Jev nor the cache when Jev is not connected', async () => {
    await t.db.query('DELETE FROM advisor_connections');
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    expect(await builder.runOnce()).toBe(true);
    await relabel(builder);
    await scanner.idle();

    const result = await outcome();
    expect(jev.requests).toHaveLength(0);
    expect(result).toMatchObject({
      repo: { status: 'ready', error: null },
      sources: ['rules'],
      cached: 0,
      calls: [],
    });
    expect(result.labels).toBeGreaterThan(0);
  });

  it('falls back to rule labels, stores nothing and stops asking when Jev returns errors', async () => {
    let asked = 0;
    const failing: typeof fetch = async () => {
      asked += 1;
      return jsonResponse(500, { error: 'boom' });
    };
    const { builder, scanner } = mapBuilder(t, failing);
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    const result = await outcome();
    expect(result).toMatchObject({
      repo: { status: 'ready', error: null },
      sources: ['rules'],
      cached: 0,
    });
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThanOrEqual(LABEL_GIVE_UP_AFTER);
    expect(result.calls.every((call) => call.jev_status === 'failed')).toBe(true);
    expect(result.labels).toBeGreaterThan(0);
  });

  it('falls back to rule labels after a short wait when Jev never answers', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const { builder, scanner } = mapBuilder(t, hanging, { jevTimeoutMs: 40 });
    const started = Date.now();
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    const result = await outcome();
    expect(result).toMatchObject({
      repo: { status: 'ready', error: null },
      sources: ['rules'],
      cached: 0,
    });
    expect(result.calls.length).toBeLessThanOrEqual(LABEL_GIVE_UP_AFTER);
    expect(result.calls.every((call) => call.jev_status === 'timed_out')).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
