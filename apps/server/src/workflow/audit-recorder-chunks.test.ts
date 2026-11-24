import { describe, expect, it } from 'vitest';
import { chainRows, verifyChain } from '../audit/hash-chain.ts';
import { MERGED_CHUNK_MAX_BYTES } from '../audit/merge-chunks.ts';
import type { ProtocolEntry } from '../audit/protocol-entry.ts';
import { createAuditRecorder, type AuditRecorderOptions } from './audit-recorder.ts';

type ChunkKind = 'agent_message_chunk' | 'agent_thought_chunk';

const chunk = (text: string, kind: ChunkKind = 'agent_message_chunk', sessionId = 's1') => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId, update: { sessionUpdate: kind, content: { type: 'text', text } } },
});

const toolCall = (toolCallId: string) => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId, title: 'Read' } },
});

const sizeOf = (message: unknown) => Buffer.byteLength(JSON.stringify(message), 'utf8');

function recorder(options: Partial<AuditRecorderOptions> = {}) {
  const written: ProtocolEntry[] = [];
  const audit = createAuditRecorder({
    write: async (entries) => {
      written.push(...entries);
    },
    flushMs: 10_000,
    ...options,
  });
  return { audit, written };
}

function shape(entry: ProtocolEntry) {
  const { update, sessionId } = (
    entry.payload as { params: { sessionId?: string; update: Record<string, unknown> } }
  ).params;
  const content = update.content as { text?: string } | undefined;
  return `${sessionId}:${String(update.sessionUpdate)}:${content?.text ?? update.toolCallId}`;
}

describe('streamed text in the audit log', () => {
  it('stores consecutive chunks of one message as one entry with their summed size', async () => {
    const { audit, written } = recorder();
    const pieces = ['Hel', 'lo ', 'world'].map((text) => chunk(text));
    for (const piece of pieces) audit.message('from_agent', piece);
    await audit.close();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      direction: 'from_agent',
      kind: 'notification',
      method: 'session/update',
      truncated: false,
      sizeBytes: pieces.reduce((bytes, piece) => bytes + sizeOf(piece), 0),
      payload: chunk('Hello world'),
    });
  });

  it('keeps the order of text around every other entry', async () => {
    const { audit, written } = recorder();
    audit.message('from_agent', chunk('a'));
    audit.message('from_agent', chunk('b'));
    audit.message('from_agent', toolCall('t1'));
    audit.message('from_agent', chunk('c'));
    audit.message('to_agent', chunk('d'));
    audit.message('from_agent', chunk('e'));
    audit.message('from_agent', chunk('f'));
    await audit.close();
    expect(written.map(shape)).toEqual([
      's1:agent_message_chunk:ab',
      's1:tool_call:t1',
      's1:agent_message_chunk:c',
      's1:agent_message_chunk:d',
      's1:agent_message_chunk:ef',
    ]);
    expect(written.map((entry) => entry.direction)).toEqual([
      'from_agent',
      'from_agent',
      'from_agent',
      'to_agent',
      'from_agent',
    ]);
  });

  it('never joins thoughts with replies, two sessions, or chunks that differ beyond their text', async () => {
    const { audit, written } = recorder();
    audit.message('from_agent', chunk('think ', 'agent_thought_chunk'));
    audit.message('from_agent', chunk('more', 'agent_thought_chunk'));
    audit.message('from_agent', chunk('say'));
    audit.message('from_agent', chunk('child', 'agent_message_chunk', 's2'));
    const tagged = chunk('tagged');
    audit.message('from_agent', { ...tagged, params: { ...tagged.params, _meta: { id: 1 } } });
    audit.message('from_agent', {
      ...chunk('x'),
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x' } },
      },
    });
    await audit.close();
    expect(written).toHaveLength(5);
    expect(written.slice(0, 3).map(shape)).toEqual([
      's1:agent_thought_chunk:think more',
      's1:agent_message_chunk:say',
      's2:agent_message_chunk:child',
    ]);
  });

  it('starts a new entry once a merged one is large, losing no text', async () => {
    const { audit, written } = recorder({ batchSize: 10_000 });
    const piece = 'x'.repeat(1_000);
    const count = Math.ceil((MERGED_CHUNK_MAX_BYTES * 2.5) / 1_000);
    for (let index = 0; index < count; index += 1) audit.message('from_agent', chunk(piece));
    await audit.close();
    expect(written.length).toBeGreaterThan(2);
    expect(written.length).toBeLessThan(count / 4);
    for (const entry of written)
      expect(entry.sizeBytes).toBeLessThanOrEqual(MERGED_CHUNK_MAX_BYTES);
    const text = written.map((entry) => shape(entry).split(':')[2]).join('');
    expect(text).toBe(piece.repeat(count));
  });

  it('does not add to an entry that is already being written', async () => {
    const batches: string[][] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const audit = createAuditRecorder({
      write: async (entries) => {
        batches.push(entries.map(shape));
        await held;
      },
      batchSize: 2,
      flushMs: 10_000,
    });
    audit.message('from_agent', toolCall('t1'));
    audit.message('from_agent', chunk('first'));
    await Promise.resolve();
    audit.message('from_agent', chunk(' second'));
    release();
    await audit.close();
    expect(batches).toEqual([
      ['s1:tool_call:t1', 's1:agent_message_chunk:first'],
      ['s1:agent_message_chunk: second'],
    ]);
  });

  it('keeps merging into a batch whose write failed, in order', async () => {
    const written: string[] = [];
    let failures = 1;
    const audit = createAuditRecorder({
      write: async (entries) => {
        if (failures-- > 0) throw new Error('database down');
        written.push(...entries.map(shape));
      },
      batchSize: 2,
      flushMs: 10_000,
    });
    audit.message('from_agent', toolCall('t1'));
    audit.message('from_agent', chunk('a'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    audit.message('from_agent', chunk('b'));
    await audit.close();
    expect(written).toEqual(['s1:tool_call:t1', 's1:agent_message_chunk:ab']);
  });

  it('keeps an entry marked as ran without review apart from the text around it', async () => {
    const { audit, written } = recorder();
    audit.message('from_agent', chunk('a'));
    audit.message('from_agent', chunk('b'), { unreviewed: true });
    audit.message('from_agent', chunk('c'));
    await audit.close();
    expect(written.map((entry) => [shape(entry), entry.unreviewed === true])).toEqual([
      ['s1:agent_message_chunk:a', false],
      ['s1:agent_message_chunk:b', true],
      ['s1:agent_message_chunk:c', false],
    ]);
  });

  it('chains merged entries like any other', async () => {
    const { audit, written } = recorder();
    audit.message('to_agent', { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: {} });
    for (const text of ['a', 'b', 'c']) audit.message('from_agent', chunk(text));
    audit.message('from_agent', toolCall('t1'));
    for (const text of ['d', 'e']) audit.message('from_agent', chunk(text));
    await audit.close();
    const rows = chainRows(
      null,
      written.map((entry) => ({
        runId: '00000000-0000-4000-8000-000000000001',
        at: entry.at.toISOString(),
        direction: entry.direction,
        kind: entry.kind,
        method: entry.method,
        rpcId: entry.rpcId,
        sizeBytes: entry.sizeBytes,
        truncated: entry.truncated,
        payload: entry.payload,
      })),
    );
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    expect(verifyChain(rows)).toMatchObject({ intact: true, checked: 4 });
  });
});
