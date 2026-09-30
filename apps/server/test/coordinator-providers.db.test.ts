import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('provider fallback for pieces', { timeout: 120_000 }, () => {
  it('moves a Codex piece to Claude when Codex is rate limited before its first edit', async () => {
    const { runId, orchestration } = await runOnCodex('#pieces #ratelimit');
    expect(orchestration.status).toBe('succeeded');
    const p1 = (await children(t, runId)).filter((child) => child.pieceKey === 'P1');
    expect(p1.map((child) => [child.provider, child.status])).toEqual([
      ['codex', 'failed'],
      ['claude', 'succeeded'],
    ]);
    expect(p1[0]!.error).toMatch(/rate limited/);
    expect(p1[1]!.prompt).not.toContain('## Handoff');
    const list = await pieceList(t, runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status, piece.provider])).toEqual([
      ['P1', 'landed', 'claude'],
      ['P2', 'landed', 'claude'],
      ['P3', 'landed', 'claude'],
    ]);
    expect(list.pieces[0]!.note).toBe('moved from Codex (rate limited)');
    expect(await readFile(join(root, 'store.ts'), 'utf8')).toBe('built by P1\n');
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('P1: moved from Codex (rate limited)');
  });

  it('hands a Codex piece to Claude with its edits after the first edit', async () => {
    const { runId, orchestration } = await runOnCodex('#pieces #ratelimitafter');
    expect(orchestration.status).toBe('succeeded');
    const p1 = (await children(t, runId)).filter((child) => child.pieceKey === 'P1');
    expect(p1.map((child) => [child.provider, child.status])).toEqual([
      ['codex', 'failed'],
      ['claude', 'succeeded'],
    ]);
    const handoff = p1[1]!.prompt;
    expect(handoff).toContain('## Handoff');
    expect(handoff).toContain('from a Builder on Codex, which stopped (rate limited)');
    expect(handoff).toContain('- store.ts');
    expect(handoff).toContain('store.ts | 1 +');
    expect(p1[1]!.resumeKey).toMatch(/:piece:P1:2$/);
    expect(await readFile(join(root, 'store.ts'), 'utf8')).toBe('built by P1\nbuilt by P1\n');
    const list = await pieceList(t, runId);
    expect(list.pieces[0]).toMatchObject({ status: 'landed', provider: 'claude', check: 'passed' });
    expect(list.pieces[0]!.filesChanged).toEqual(['store.ts']);
  });
});
