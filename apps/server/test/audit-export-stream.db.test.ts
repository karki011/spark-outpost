import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditFileLineSchema } from '@spark-outpost/contracts';
import { createProtocolRecorder } from '../src/audit/protocol-entry.ts';
import { insertProtocolEntries } from '../src/persistence/audit-log.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const MESSAGES = 3_000;
const INSERT_BATCH = 500;

async function bigRun(conversationId: string): Promise<string> {
  await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'go' },
    { provider: 'claude', model: 'sonnet' },
  );
  const lease = (await claimNextJob(t.db, 30))!;
  const recorder = createProtocolRecorder();
  const text = 'x'.repeat(1_000);
  for (let start = 0; start < MESSAGES; start += INSERT_BATCH) {
    const entries = Array.from({ length: INSERT_BATCH }, (_, offset) =>
      recorder.entry('from_agent', {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { index: start + offset, text },
      }),
    );
    await insertProtocolEntries(t.db, lease, entries);
  }
  return lease.runId;
}

interface Streamed {
  text: string;
  chunks: number;
}

function collectChunks(res: IncomingMessage, done: (error: Error | null, body: Streamed) => void) {
  let text = '';
  let chunks = 0;
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    chunks += 1;
    text += chunk;
  });
  res.on('end', () => done(null, { text, chunks }));
}

describe('audit JSONL export of a large chat', () => {
  it('streams every message in chunks while the server keeps serving other work', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const runId = await bigRun(conversation.id);

    let turns = 0;
    let ticking = true;
    const tick = () => {
      if (!ticking) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    const response = await request(app)
      .get(`/api/conversations/${conversation.id}/audit/export.jsonl`)
      .set(LOCAL_HEADERS)
      .buffer(true)
      .parse((res, done) => collectChunks(res as unknown as IncomingMessage, done));
    ticking = false;

    expect(response.status).toBe(200);
    expect(response.headers['transfer-encoding']).toBe('chunked');
    expect(response.headers['content-length']).toBeUndefined();
    const body = response.body as Streamed;
    expect(body.chunks).toBeGreaterThan(10);
    expect(turns).toBeGreaterThan(MESSAGES / 100);
    const lines = body.text
      .trimEnd()
      .split('\n')
      .map((line) => auditFileLineSchema.parse(JSON.parse(line)))
      .filter((line) => line.type === 'run' || line.type === 'log');
    expect(lines).toHaveLength(MESSAGES + 1);
    expect(lines[0]).toMatchObject({ type: 'run', runId });
    const seqs = lines.flatMap((line) => (line.type === 'log' ? [line.seq] : []));
    expect(seqs).toEqual(Array.from({ length: MESSAGES }, (_, index) => index + 1));
  }, 60_000);
});
