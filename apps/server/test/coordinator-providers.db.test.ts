import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectConformantRun } from './agui-conformance.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { children, pieceList, startPieces } from './coordinator-support.ts';
import {
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function runOnCodex(tags: string) {
  const started = await startPieces(t, root, tags, { provider: 'codex' });
  harness = started.harness;
  const { orchestration } = await driveToEnd(
    t,
    started.conversationId,
    started.runId,
    undefined,
    90_000,
  );
  return { runId: started.runId, orchestration };
}

describe('a piece whose provider fails', { timeout: 120_000 }, () => {
  it.each(['#ratelimit', '#ratelimitafter', '#turn429', '#retry429', '#turn429after'])(
    'fails on Codex with the plain reason and never moves to another provider (%s)',
    async (tag) => {
      const { runId, orchestration } = await runOnCodex(`#pieces ${tag}`);
      const builders = (await children(t, runId)).filter((child) => child.role === 'builder');
      expect(new Set(builders.map((child) => child.provider))).toEqual(new Set(['codex']));
      const p1 = builders.filter((child) => child.pieceKey === 'P1');
      expect(p1.length).toBeGreaterThan(0);
      expect(new Set(p1.map((child) => child.status))).toEqual(new Set(['failed']));
      expect(p1[0]!.error).toMatch(/rate limited/);
      await expectConformantRun(t.db, runId);
      const list = await pieceList(t, runId);
      expect(list.pieces[0]).toMatchObject({ key: 'P1', status: 'failed', provider: 'codex' });
      expect(list.pieces[0]!.note).not.toMatch(/moved from/);
      expect(list.pieces.every((piece) => piece.provider === 'codex')).toBe(true);
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toMatch(/P1[^\n]*failed[^\n]*rate limited/);
      expect(orchestration.status).not.toBe('running');
    },
  );
});
