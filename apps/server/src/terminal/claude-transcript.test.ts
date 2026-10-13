import { describe, expect, it } from 'vitest';
import { fixtureRecords, turnTotals } from '../../test/fixtures/terminal-usage/read.ts';
import { claudeTranscriptParser } from './claude-transcript.ts';
import type { TranscriptRecord } from './native-transcript.ts';

const parse = (...records: unknown[]) => {
  const parser = claudeTranscriptParser();
  return records.flatMap((record) =>
    parser.push(typeof record === 'string' ? record : JSON.stringify(record)),
  );
};
const interrupt = (promptId: string, text = '[Request interrupted by user]') => ({
  type: 'user',
  isSidechain: false,
  promptId,
  message: { role: 'user', content: [{ type: 'text', text }] },
});
const assistant = (id: string, usage: Record<string, unknown>, model = 'claude-opus-5-5') => ({
  type: 'assistant',
  isSidechain: false,
  message: { id, model, usage, content: [{ type: 'text', text: 'ok' }] },
});
const reported = (records: readonly TranscriptRecord[]) =>
  records.flatMap((record) => (record.kind === 'reported' ? [record.usage] : []));

describe('Claude interrupt records', () => {
  it('reads the turn of an interrupt record and of an interrupted tool use', () => {
    expect(
      parse(interrupt('first'), interrupt('second', '[Request interrupted by user for tool use]')),
    ).toEqual([
      { kind: 'interrupt', turnId: 'first' },
      { kind: 'interrupt', turnId: 'second' },
    ]);
  });

  it('ignores a prompt the user typed, other records, sidechains and text that is not JSON', () => {
    const typed = {
      type: 'user',
      promptId: 'typed',
      message: { role: 'user', content: '[Request interrupted by user]' },
    };
    const quoted = interrupt('quoted');
    quoted.message.content.push({ type: 'text', text: 'more' });
    const said = {
      type: 'assistant',
      promptId: 'assistant',
      message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    };
    const { promptId: _promptId, ...untitled } = interrupt('x');
    expect(
      parse(
        typed,
        quoted,
        said,
        '{[Request interrupted by user]',
        'null',
        { ...interrupt('sidechain'), isSidechain: true },
        untitled,
      ),
    ).toEqual([]);
  });
});

describe('Claude usage records', () => {
  it('reads each response under the prompt it follows and ignores unknown record types', () => {
    const usage = {
      input_tokens: 2,
      output_tokens: 40,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
      output_tokens_details: { thinking_tokens: 7 },
    };
    const tokens = {
      input: 2,
      output: 40,
      cachedRead: 100,
      cachedWrite: 30,
      cachedWriteLong: 20,
      thought: 7,
    };
    expect(
      parse(
        assistant('before-any-prompt', usage),
        { type: 'user', promptId: 'p1', message: { role: 'user', content: 'Hello' } },
        { type: 'a-type-from-the-future', message: { id: 'x', usage } },
        { type: 'system', subtype: 'turn_duration', durationMs: 5 },
        { ...assistant('sidechain', usage), isSidechain: true },
        assistant('msg_1', usage),
        { type: 'assistant', message: { id: 'no-usage', model: 'claude-opus-5-5' } },
        { type: 'assistant', message: { model: 'claude-opus-5-5', usage } },
        assistant('msg_2', { input_tokens: 'many', output_tokens: -4 }),
      ),
    ).toEqual([
      {
        kind: 'response',
        turnId: null,
        responseId: 'before-any-prompt',
        model: 'claude-opus-5-5',
        tokens,
      },
      { kind: 'response', turnId: 'p1', responseId: 'msg_1', model: 'claude-opus-5-5', tokens },
      {
        kind: 'response',
        turnId: 'p1',
        responseId: 'msg_2',
        model: 'claude-opus-5-5',
        tokens: {
          input: 0,
          output: 0,
          cachedRead: 0,
          cachedWrite: 0,
          cachedWriteLong: 0,
          thought: 0,
        },
      },
    ]);
  });

  it('reads the session total Claude Code reports and refuses a malformed one', () => {
    const state = {
      type: 'cost-state',
      sessionId: 's1',
      totalCostUSD: 0.25,
      modelUsage: {
        'claude-opus-5-5': {
          inputTokens: 10,
          outputTokens: 20,
          thinkingTokens: 3,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 40,
          costUSD: 0.2,
        },
        broken: 'not a record',
      },
    };
    expect(
      reported(
        parse(
          state,
          { ...state, totalCostUSD: '0.25' },
          { ...state, totalCostUSD: -1 },
          { ...state, sessionId: 4 },
        ),
      ),
    ).toEqual([
      {
        nativeSessionId: 's1',
        costUsd: 0.25,
        models: [
          {
            model: 'claude-opus-5-5',
            input: 10,
            output: 20,
            cachedRead: 30,
            cachedWrite: 40,
            thought: 3,
            costUsd: 0.2,
          },
        ],
      },
    ]);
  });
});

describe('Claude Code 2.1.296 session files', () => {
  it('counts each response once and prices a three-turn session below the CLI total', () => {
    const records = fixtureRecords('claude-three-turns.jsonl', claudeTranscriptParser());
    const turns = [...turnTotals('claude', records).values()];
    expect(turns.map((turn) => [turn.tokens.output, turn.costUsd])).toEqual([
      [4, 0.105045],
      [141, 0.120584],
      [61, 0.010651],
    ]);
    const totals = reported(records);
    expect(new Set(totals.map((total) => total.costUsd))).toEqual(new Set([0.2624324]));
    const opus = totals.at(-1)!.models.find((model) => model.model === 'claude-opus-5-5')!;
    expect(opus.output).toBe(392);
    expect(turns.reduce((sum, turn) => sum + turn.tokens.output, 0)).toBe(206);
    expect(
      totals
        .at(-1)!
        .models.map((model) => model.model)
        .sort(),
    ).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
  });

  it('reads a resumed session with an interrupt, a sub-agent call and repeated totals', () => {
    const records = fixtureRecords(
      'claude-resume-interrupt-subagent.jsonl',
      claudeTranscriptParser(),
    );
    expect(records.filter((record) => record.kind === 'interrupt')).toEqual([
      { kind: 'interrupt', turnId: '5c688c6c-7dc2-459c-9c3b-394259bbc1b8' },
    ]);
    const responses = records.filter((record) => record.kind === 'response');
    expect(responses).toHaveLength(11);
    expect(new Set(responses.map((response) => response.responseId)).size).toBe(8);
    const turns = turnTotals('claude', records);
    expect([...turns.values()].map((turn) => turn.costUsd)).toEqual([
      0.150669, 0.032159, 0.014193, 0.014534, 0.012483,
    ]);
    expect(turns.get('3dc9909e-15d8-4026-9e0f-50c6dd227bc3')!.tokens).toMatchObject({
      input: 4,
      output: 237,
      cachedRead: 64247,
      cachedWrite: 16633,
    });
    expect(reported(records).map((total) => total.costUsd)).toEqual([
      0.40360429999999997, 0.40360429999999997, 0.42819989999999997, 0.42819989999999997,
    ]);
    expect(
      fixtureRecords('claude-subagent.jsonl', claudeTranscriptParser()).filter(
        (record) => record.kind === 'response',
      ),
    ).toEqual([]);
  });
});
