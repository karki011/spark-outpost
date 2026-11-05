import { describe, expect, it } from 'vitest';
import type { ProtocolEntry } from '../audit/protocol-entry.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { createAuditRecorder, type AuditRecorderOptions } from './audit-recorder.ts';

const lease = { jobId: 'j', runId: 'r', token: 't', attempt: 1 };
const note = (index: number) => ({ jsonrpc: '2.0', method: 'session/update', params: { index } });

function recorder(options: Partial<AuditRecorderOptions> = {}) {
  const batches: ProtocolEntry[][] = [];
  const audit = createAuditRecorder({
    write: async (entries) => {
      batches.push(entries);
    },
    flushMs: 10_000,
    ...options,
  });
  return { audit, batches };
}

describe('audit recorder', () => {
  it('writes as soon as a batch fills and the rest on close', async () => {
    const { audit, batches } = recorder({ batchSize: 2 });
    audit.message('from_agent', note(1));
    audit.message('from_agent', note(2));
    await Promise.resolve();
    expect(batches.map((batch) => batch.length)).toEqual([2]);
    audit.message('from_agent', note(3));
    await audit.close();
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    audit.message('from_agent', note(4));
    await audit.close();
    expect(batches.flat()).toHaveLength(3);
  });

  it('flushes on a timer without waiting for a full batch', async () => {
    const { audit, batches } = recorder({ batchSize: 100, flushMs: 5 });
    audit.message('to_agent', note(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(batches.flat()).toHaveLength(1);
    await audit.close();
  });

  it('retries a failed batch and keeps the order', async () => {
    const written: ProtocolEntry[] = [];
    let failures = 1;
    const audit = createAuditRecorder({
      write: async (entries) => {
        if (failures-- > 0) throw new Error('database down');
        written.push(...entries);
      },
      batchSize: 1,
    });
    const errors = console.error;
    console.error = () => undefined;
    audit.message('to_agent', note(1));
    audit.message('to_agent', note(2));
    await audit.close();
    console.error = errors;
    expect(written.map((entry) => (entry.payload as { params: unknown }).params)).toEqual([
      { index: 1 },
      { index: 2 },
    ]);
  });

  it('stops recording once the lease is lost', async () => {
    let calls = 0;
    const audit = createAuditRecorder({
      write: async () => {
        calls += 1;
        throw new LeaseLostError(lease);
      },
      batchSize: 1,
    });
    audit.message('to_agent', note(1));
    audit.message('to_agent', note(2));
    await audit.close();
    expect(calls).toBe(1);
  });

  it('counts tool calls the agent starts', async () => {
    const { audit } = recorder();
    const update = (sessionUpdate: string) => ({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate, toolCallId: 'a' } },
    });
    audit.message('from_agent', update('tool_call'));
    audit.message('from_agent', update('tool_call_update'));
    audit.message('from_agent', update('tool_call'));
    audit.message('to_agent', update('tool_call'));
    expect(audit.toolCallCount()).toBe(2);
    await audit.close();
  });

  it('stores stderr by whole lines, redacted, and holds a partial line until close', async () => {
    const { audit, batches } = recorder();
    audit.stderr('starting\nGITHUB_TOKEN=abc');
    audit.stderr('def\npartial');
    await audit.close();
    const texts = batches.flat().map((entry) => (entry.payload as { text: string }).text);
    expect(texts).toEqual(['starting\n', 'GITHUB_TOKEN=[redacted:env]\n', 'partial']);
    expect(batches.flat().every((entry) => entry.kind === 'stderr')).toBe(true);
  });

  it('caps stderr and records how much was left out', async () => {
    const { audit, batches } = recorder({ stderrCapBytes: 10 });
    audit.stderr('0123456789abc\n');
    audit.stderr('more\n');
    await audit.close();
    const entries = batches.flat();
    expect(entries.map((entry) => entry.payload)).toEqual([
      { text: '0123456789' },
      { omittedBytes: 9, capBytes: 10 },
    ]);
    expect(entries.at(-1)).toMatchObject({ truncated: true, sizeBytes: 9 });
  });

  it('discards buffered entries without writing', async () => {
    const { audit, batches } = recorder();
    audit.message('to_agent', note(1));
    audit.discard();
    await audit.close();
    expect(batches).toEqual([]);
  });
  it('marks a tool call that ran without a permission request as unreviewed', async () => {
    const { audit, batches } = recorder();
    const update = (toolCallId: string, fields: Record<string, unknown>) => ({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'tool_call_update', toolCallId, ...fields } },
    });
    audit.message('from_agent', update('w', { kind: 'edit', status: 'pending' }));
    audit.message('from_agent', update('w', { status: 'completed' }));
    audit.message('from_agent', update('a', { kind: 'execute', status: 'pending' }));
    audit.message('from_agent', {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: { toolCall: { toolCallId: 'a' }, options: [] },
    });
    audit.message('from_agent', update('a', { status: 'completed' }));
    audit.message('from_agent', update('r', { kind: 'read', status: 'completed' }));
    audit.message('from_agent', update('w', { status: 'completed' }));
    audit.message(
      'from_agent',
      update('p', { kind: 'edit', rawInput: { file_path: '/repo/.spark/plans/quiet-plan.md' } }),
    );
    audit.message('from_agent', update('p', { status: 'completed' }));
    await audit.close();
    expect(batches.flat().map((entry) => entry.unreviewed === true)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('marks an entry Spark says ran without review, and no other', async () => {
    const { audit, batches } = recorder();
    const started = { method: 'spark/terminal_start', params: { decision: 'mode' } };
    audit.message('harness', started, { unreviewed: true });
    audit.message('harness', started, {});
    audit.message('harness', started);
    await audit.close();
    expect(batches.flat().map((entry) => entry.unreviewed === true)).toEqual([true, false, false]);
  });
});
