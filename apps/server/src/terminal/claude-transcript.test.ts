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
    const untitled = { ...interrupt('x'), promptId: undefined };
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

describe('session files of the real-agent pass', () => {
  const HUMAN = [
    '7813aacd-16b3-477d-8bbc-4eea80f27deb',
    '50412762-da7a-46f7-92b6-77eb171a69eb',
    'e7800f6f-7aa4-4ea1-a883-19ba220a2bf7',
  ];

  it('files a handback reply and the sub-agent under the prompt the user typed', () => {
    const main = fixtureRecords('claude-pass-resume-handback.jsonl', claudeTranscriptParser());
    const side = fixtureRecords('claude-pass-subagent.jsonl', claudeTranscriptParser(true));
    const prompts = main.filter((record) => record.kind === 'prompt');
    expect(prompts.filter((record) => record.human).map((record) => record.promptId)).toEqual(
      HUMAN,
    );
    expect(prompts.filter((record) => !record.human)).toEqual([
      {
        kind: 'prompt',
        promptId: '4d9e891c-2f4e-42b7-a689-c77d4d513d6d',
        human: false,
        owner: HUMAN[2],
        agentId: 'ad1f5f51c14fb7c05',
      },
      {
        kind: 'prompt',
        promptId: '8d1404eb-1668-478f-aa95-285feb28e0b0',
        human: false,
        owner: HUMAN[2],
        agentId: null,
      },
    ]);
    expect(side.filter((record) => record.kind === 'prompt')).toEqual([]);
    const turns = turnTotals('claude', [...main, ...side]);
    expect([...turns.keys()]).toEqual(HUMAN);
    const costs = [...turns.values()].map((turn) => turn.costUsd!);
    expect(costs[0]! + costs[1]!).toBeCloseTo(0.158766, 6);
    expect(costs).toEqual([0.149424, 0.009342, 0.136982]);
    expect(reported(main).map((total) => total.costUsd)).toEqual([
      0.1602545, 0.1602545, 0.3352450999999999, 0.3352450999999999,
    ]);
  });

  it('gives a handback to the turn that started the sub-agent, not to the prompt typed meanwhile', () => {
    const main = fixtureRecords(
      'claude-pass2-typed-during-subagent.jsonl',
      claudeTranscriptParser(),
    );
    const side = fixtureRecords('claude-pass2-subagent.jsonl', claudeTranscriptParser(true));
    const prompts = main.flatMap((record) => (record.kind === 'prompt' ? [record] : []));
    expect(prompts.map((record) => [record.promptId.slice(0, 8), record.human])).toEqual([
      ['5d960b67', true],
      ['a57adc62', true],
      ['a973dbb2', false],
      ['84959583', true],
      ['0dca7edf', false],
      ['cda4cddf', false],
    ]);
    expect(prompts[4]!.owner).toBe(prompts[1]!.promptId);
    expect(prompts[2]!.owner).toBe(prompts[1]!.promptId);
    const turns = turnTotals('claude', [...main, ...side]);
    expect([...turns].map(([turnId, turn]) => [turnId!.slice(0, 8), turn.tokens.output])).toEqual([
      ['5d960b67', 5],
      ['a57adc62', 563],
      ['84959583', 5],
    ]);
    expect(side.every((record) => record.kind === 'response')).toBe(true);
    expect(reported(main).at(-1)!.costUsd).toBe(0.5428069);
  });

  it('reads the total of the session before /clear and of the one after it', () => {
    const before = fixtureRecords('claude-pass-first-then-clear.jsonl', claudeTranscriptParser());
    const after = fixtureRecords('claude-pass-after-clear.jsonl', claudeTranscriptParser());
    expect(reported(before).at(-1)!.costUsd).toBe(0.0814073);
    expect(reported(after).at(-1)!.costUsd).toBe(0.11206370000000002);
    expect([...turnTotals('claude', before).values()].map((turn) => turn.costUsd)).toEqual([
      0.08128,
    ]);
    expect([...turnTotals('claude', after).values()].map((turn) => turn.costUsd)).toEqual([
      0.111936,
    ]);
  });
});

describe('Claude tool records', () => {
  const steps = (records: readonly TranscriptRecord[]) =>
    records.flatMap((record) => (record.kind === 'step' ? [record] : []));

  it('reads each tool call of a real session with its name, turn and time', () => {
    const found = steps(fixtureRecords('claude-three-turns.jsonl', claudeTranscriptParser()));
    expect(found.map((step) => [step.phase, step.name, step.failed])).toEqual([
      ['start', found[0]!.name, false],
      ['end', found[0]!.name, found[1]!.failed],
    ]);
    expect(found[0]!.id).toBe(found[1]!.id);
    expect(found[0]!.turnId).toBe(found[1]!.turnId);
    expect(Number.isNaN(Date.parse(found[0]!.at!))).toBe(false);
  });

  it('gives a tool call that starts before any prompt record the turn the reader was opened with', () => {
    const parser = claudeTranscriptParser(false, 'open-turn');
    const call = {
      type: 'assistant',
      timestamp: '2026-10-13T07:10:00.000Z',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash' }] },
    };
    const result = {
      type: 'user',
      promptId: 'open-turn',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }] },
    };
    expect(steps([call, result].flatMap((record) => parser.push(JSON.stringify(record))))).toEqual([
      {
        kind: 'step',
        turnId: 'open-turn',
        id: 'toolu_1',
        name: 'Bash',
        phase: 'start',
        failed: false,
        at: '2026-10-13T07:10:00.000Z',
      },
      {
        kind: 'step',
        turnId: 'open-turn',
        id: 'toolu_1',
        name: 'Bash',
        phase: 'end',
        failed: true,
        at: null,
      },
    ]);
  });

  it('drops a result whose call it never saw', () => {
    const result = {
      type: 'user',
      promptId: 'p',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_unknown' }] },
    };
    expect(steps(parse(result))).toEqual([]);
  });
});
