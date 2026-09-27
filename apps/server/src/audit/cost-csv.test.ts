import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditRunSummary } from '@spark-outpost/contracts';
import { costCsv, csvCell } from './cost-csv.ts';

function run(overrides: Partial<AuditRunSummary> = {}): AuditRunSummary {
  return {
    runId: randomUUID(),
    userMessageId: randomUUID(),
    provider: 'codex',
    role: 'Scout',
    runMode: 'ask',
    model: 'gpt-6-sol',
    effort: 'high',
    mode: 'read-only',
    status: 'succeeded',
    createdAt: '2026-09-26T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    approvalWaits: [],
    durationMs: 1200,
    toolCallCount: 3,
    inputTokens: 1000,
    outputTokens: 200,
    cachedReadTokens: 400,
    cachedWriteTokens: null,
    thoughtTokens: 50,
    totalTokens: 1200,
    costUsd: 0.0032,
    costSource: 'estimated',
    logEntries: 4,
    logPruned: false,
    methods: [],
    ...overrides,
  };
}

describe('cost CSV', () => {
  it('writes one header and one CRLF-terminated row per run', () => {
    const first = run();
    const csv = costCsv([first, run({ provider: 'claude', costSource: 'reported' })]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
    expect(lines[0]).toBe(
      'run_id,created_at,role,provider,model,effort,mode,status,input_tokens,output_tokens,' +
        'cached_read_tokens,cached_write_tokens,thinking_tokens,total_tokens,cost_usd,' +
        'cost_source,duration_ms,tool_calls,file_reads',
    );
    expect(lines[1]).toBe(
      `${first.runId},2026-09-26T10:00:00.000Z,Scout,codex,gpt-6-sol,high,ask,succeeded,` +
        '1000,200,400,,50,1200,0.0032,estimated,1200,3,',
    );
    expect(lines[2]).toContain(',reported,');
  });

  it('adds the file reads a crew member recorded', () => {
    const csv = costCsv([run({ fileReads: 5 })]);
    expect(csv.split('\r\n')[1]).toMatch(/,3,5$/);
  });

  it('marks a run without a cost as not reported instead of guessing', () => {
    const csv = costCsv([run({ costUsd: null, costSource: null })]);
    expect(csv.split('\r\n')[1]).toContain(',,not_reported,');
  });

  it('writes only the header for a chat with no runs', () => {
    expect(costCsv([]).split('\r\n')).toHaveLength(2);
  });

  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('opus[1m]')).toBe('opus[1m]');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(null)).toBe('');
  });
});
