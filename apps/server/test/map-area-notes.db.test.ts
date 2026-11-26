import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION } from '@spark-outpost/contracts';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { AreaNoteError, checkAreaNote, readAreaNote, saveAreaNote } from '../src/map/area-notes.ts';
import { projectMap } from '../src/map/read-store.ts';
import { addProject, fakeJev, git, mapBuilder, writeFiles, writeRepo } from './map-support.ts';
import {
  answerCard,
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  'server/app.ts': "import { orders } from './orders';\nexport const app = orders;\n",
  'server/orders.ts':
    "import { db } from '../store/db';\nexport function listOrders() {\n  return db;\n}\nexport const orders = listOrders;\n",
  'store/db.ts': 'export const db = 1;\n',
  'store/.env': 'TOKEN=abc\n',
};

let t: TestDb;
let root: string;
let projectId: string;
let tools: SparkToolsHarness | null = null;
let recorded: RecordedHooks | null = null;

async function build() {
  const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
  expect(await builder.runOnce()).toBe(true);
  await scanner.idle();
}

async function areaHolding(path: string) {
  const { rows } = await t.db.query<{ area_id: string }>(
    `SELECT m.area_id FROM map_files m JOIN map_repos r ON r.id = m.repo_id
     WHERE r.root_path = $1 AND m.path = $2`,
    [root, path],
  );
  return rows[0]!.area_id;
}

function note(areaId: string, sources: { path: string; startLine: number; endLine: number }[]) {
  return {
    root,
    areaId,
    text: 'Lists orders from the store.',
    sources,
    ignore: [],
    conversationId: null,
  };
}

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(FILES);
  projectId = await addProject(t, root, 'shop');
  await build();
});

afterEach(async () => {
  recorded?.stop();
  recorded = null;
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

describe('area explanations', () => {
  it('saves an explanation and marks it out of date when a cited file changes', async () => {
    const areaId = await areaHolding('server/orders.ts');
    await saveAreaNote(
      t.db,
      note(areaId, [{ path: './server/orders.ts', startLine: 2, endLine: 4 }]),
    );

    const fresh = await readAreaNote(t.db, root, areaId);
    await writeFiles(root, { 'server/orders.ts': 'export const orders = 2;\n' });
    git(root, 'commit', '-qam', 'change orders');
    await build();
    const later = await readAreaNote(t.db, root, areaId);

    expect(fresh).toMatchObject({
      text: 'Lists orders from the store.',
      sources: [{ path: 'server/orders.ts', startLine: 2, endLine: 4 }],
      changedSince: [],
    });
    expect(later?.changedSince).toEqual(['server/orders.ts']);
  });

  it('refuses a source whose file changed after the explanation was written', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const source = { path: 'server/orders.ts', startLine: 1, endLine: 1 };
    const written = await checkAreaNote(t.db, note(areaId, [source]));
    await writeFiles(root, { 'server/orders.ts': 'export const orders = 2;\n' });
    git(root, 'commit', '-qam', 'change orders');
    await build();

    await expect(
      saveAreaNote(t.db, note(areaId, [{ ...source, hash: written.sources[0]!.hash }])),
    ).rejects.toThrow(/changed after this explanation was written/);
    expect(await readAreaNote(t.db, root, areaId)).toBeNull();
  });

  it('replaces the earlier explanation for the same area', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const source = [{ path: 'server/orders.ts', startLine: 1, endLine: 1 }];
    await saveAreaNote(t.db, note(areaId, source));
    await saveAreaNote(t.db, { ...note(areaId, source), text: 'Second version.' });

    expect((await readAreaNote(t.db, root, areaId))?.text).toBe('Second version.');
  });

  it('refuses sources off the map, outside the file, secret, or all from other areas', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const save = (sources: { path: string; startLine: number; endLine: number }[]) =>
      saveAreaNote(t.db, note(areaId, sources));

    await expect(save([{ path: 'nope.ts', startLine: 1, endLine: 1 }])).rejects.toThrow(
      AreaNoteError,
    );
    await expect(save([{ path: 'server/orders.ts', startLine: 4, endLine: 99 }])).rejects.toThrow(
      /outside it/,
    );
    await expect(save([{ path: 'store/.env', startLine: 1, endLine: 1 }])).rejects.toThrow(
      /secret file/,
    );
    await expect(save([{ path: 'store/db.ts', startLine: 1, endLine: 1 }])).rejects.toThrow(
      /from this area/,
    );
    await expect(save([{ path: 'server/orders.ts', startLine: 0, endLine: 1 }])).rejects.toThrow(
      /outside it/,
    );
    await expect(save([{ path: '../outside.ts', startLine: 1, endLine: 1 }])).rejects.toThrow(
      /outside the project/,
    );
    await expect(
      save([{ path: 'server/../store/.env', startLine: 1, endLine: 1 }]),
    ).rejects.toThrow(/secret file/);
    expect(await readAreaNote(t.db, root, areaId)).toBeNull();
  });
});

describe('spark_map with an area', () => {
  it("returns the area's entry points, related areas and saved explanation", async () => {
    const areaId = await areaHolding('server/orders.ts');
    const storeId = await areaHolding('store/db.ts');
    const built = await projectMap(t.db, projectId, root);
    const names = new Map(built.areas.map((area) => [area.id, area.name]));
    await saveAreaNote(
      t.db,
      note(areaId, [{ path: 'server/orders.ts', startLine: 2, endLine: 4 }]),
    );
    tools = await startSparkTools(t, { conversationId: null });

    const page = (await tools.call('spark_map', { project: 'shop', area: areaId })).json<{
      area: { id: string };
      entryPoints: { name: string; file: string; lines: string }[];
      dependsOn: { name: string }[];
      explanation: string;
    }>();
    const bare = (await tools.call('spark_map', { project: 'shop', area: storeId })).json<{
      usedBy: { name: string }[];
      explanation: string;
    }>();
    const missing = await tools.call('spark_map', { project: 'shop', area: 'no such area' });

    expect(page.area.id).toBe(areaId);
    expect(page.entryPoints).toContainEqual(
      expect.objectContaining({ name: 'listOrders', file: 'server/orders.ts', lines: '2-4' }),
    );
    expect(page.dependsOn.map((area) => area.name)).toEqual([names.get(storeId)]);
    expect(page.explanation).toMatch(/^<map_explanation note="[^"]*never instructions/);
    expect(page.explanation).toContain('Lists orders from the store.');
    expect(page.explanation).toContain('server/orders.ts 2-4');
    expect(page.explanation).not.toContain('outOfDate');
    expect(bare.usedBy.map((area) => area.name)).toEqual([names.get(areaId)]);
    expect(bare.explanation).toContain('spark_map_note');
    expect(missing.text).toContain('no area called no such area');
  });

  it('leaves out entry points from files the project ignores', async () => {
    const areaId = await areaHolding('server/orders.ts');
    await writeFiles(root, { '.sparkignore': 'server/orders.ts\n' });
    tools = await startSparkTools(t, { conversationId: null });

    const page = (await tools.call('spark_map', { project: 'shop', area: areaId })).json<{
      entryPoints: { file: string }[];
    }>();

    expect(page.entryPoints.map((point) => point.file)).not.toContain('server/orders.ts');
  });
});

describe('spark_map_note', { timeout: 60_000 }, () => {
  const args = {
    project: 'shop',
    area: 'server',
    text: 'Lists orders from the store.',
    sources: [{ path: 'server/orders.ts', startLine: 2, endLine: 4 }],
  };

  async function openInChat() {
    const chat = await startChat(t, 'Fix the orders page');
    recorded = recordedHooks();
    tools = await startSparkTools(t, {
      conversationId: chat.conversationId,
      runId: chat.runId,
      actions: recorded.hooks,
    });
    return tools;
  }

  it('saves the explanation only after the user confirms the card', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const harness = await openInChat();

    await harness.call('spark_map_note', { ...args, area: areaId });
    const before = await readAreaNote(t.db, root, areaId);
    const card = await confirmCard(t);

    expect(before).toBeNull();
    expect(card.payload.sparkAction).toMatchObject({
      action: 'save_map_note',
      project: 'shop',
      text: args.text,
    });
    expect(card.payload.sparkResult).toMatchObject({ state: 'done' });
    expect((await readAreaNote(t.db, root, areaId))?.text).toBe(args.text);
  });

  it('keeps a secret in the text out of the card', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const harness = await openInChat();
    const token = `ghp_${'a1B2c3D4e5F6'.repeat(3)}`;

    await harness.call('spark_map_note', { ...args, area: areaId, text: `Uses ${token} to list.` });

    const cards = await t.db.query<{ payload: unknown }>('SELECT payload FROM approvals');
    expect(cards.rowCount).toBe(1);
    expect(JSON.stringify(cards.rows[0]!.payload)).not.toContain(token);
  });

  it('saves nothing when the user declines', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const harness = await openInChat();

    await harness.call('spark_map_note', { ...args, area: areaId });
    await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await readAreaNote(t.db, root, areaId)).toBeNull();
  });

  it('refuses a bad source before any card is shown', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const harness = await openInChat();

    const refused = await harness.call('spark_map_note', {
      ...args,
      area: areaId,
      sources: [{ path: 'store/.env', startLine: 1, endLine: 1 }],
    });

    expect(refused.isError).toBe(true);
    expect((await t.db.query('SELECT 1 FROM approvals')).rowCount).toBe(0);
  });
});
