import { describe, expect, it } from 'vitest';
import { fixtureRecords, turnTotals } from '../../test/fixtures/terminal-usage/read.ts';
import { codexRolloutParser } from './codex-rollout.ts';

const ROOT = '01a132f2-3c62-7571-81e1-82c276843d89';
const CHILD = '01a132f3-4263-77c3-a2be-67e299075490';
const TURNS = [
  '01a132f2-49b6-7dd3-88a3-30d0d9cc1618',
  '01a132f2-f33e-70e0-8001-4974a8381985',
  '01a132f3-37c3-77c0-8dce-ffbe841b6436',
];

describe('Codex 0.157.0 rollout files', () => {
  it('takes the running total of each turn, not the sum of its responses', () => {
    const records = fixtureRecords('codex-rollout.jsonl', codexRolloutParser());
    expect(records).toHaveLength(6);
    expect(new Set(records.map((record) => record.kind))).toEqual(new Set(['response']));
    const turns = turnTotals('codex', records);
    expect([...turns.keys()]).toEqual(TURNS);
    expect([...turns.values()].map((turn) => [turn.model, turn.tokens, turn.costUsd])).toEqual([
      [
        'gpt-5.6-sol',
        { input: 33884, output: 151, total: 34035, cachedRead: 24064, cachedWrite: 0, thought: 0 },
        0.051926,
      ],
      [
        'gpt-5.6-sol',
        { input: 17082, output: 321, total: 17403, cachedRead: 16896, cachedWrite: 0, thought: 16 },
        0.013922,
      ],
      [
        'gpt-5.6-sol',
        { input: 52932, output: 193, total: 53125, cachedRead: 51712, cachedWrite: 0, thought: 42 },
        0.029425,
      ],
    ]);
  });

  it('files a sub-agent thread under the parent turn that started it, skipping the copied history', () => {
    const child = fixtureRecords('codex-subagent-rollout.jsonl', codexRolloutParser());
    expect(child.map((record) => record.kind === 'response' && record.turnId)).toEqual([
      TURNS[2],
      TURNS[2],
    ]);
    const parent = fixtureRecords('codex-rollout.jsonl', codexRolloutParser());
    const turns = turnTotals('codex', [...parent, ...child]);
    expect(turns.get(TURNS[2]!)!.tokens.total).toBe(53125 + 35617);
    expect([...turns.values()].reduce((sum, turn) => sum + turn.tokens.total, 0)).toBe(140180);
    expect(
      child.every((record) => record.kind === 'response' && record.responseId.startsWith(CHILD)),
    ).toBe(true);
    expect(
      parent.every((record) => record.kind === 'response' && record.responseId.startsWith(ROOT)),
    ).toBe(true);
  });

  it('ignores records it does not know, malformed lines and usage without a turn', () => {
    const parser = codexRolloutParser();
    const usage = { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, total_tokens: 12 };
    const lines = [
      '{"type":"token_usage_record","payload":',
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: usage } },
      }),
      JSON.stringify({
        type: 'token_usage_record',
        payload: { thread_id: 't', turn_token_usage: usage },
      }),
      JSON.stringify({
        type: 'token_usage_record',
        payload: { thread_id: 't', turn_id: 'a', usage },
      }),
      JSON.stringify({ type: 'compacted', payload: { turn_id: 'a', turn_token_usage: usage } }),
      JSON.stringify({
        type: 'token_usage_record',
        payload: { thread_id: 't', turn_id: 'a', turn_token_usage: usage },
      }),
    ];
    expect(lines.flatMap((line) => parser.push(line))).toEqual([
      {
        kind: 'response',
        turnId: 'a',
        responseId: 't:a',
        model: null,
        tokens: {
          input: 10,
          output: 2,
          cachedRead: 4,
          cachedWrite: 0,
          cachedWriteLong: 0,
          thought: 0,
        },
      },
    ]);
  });
});
