import { describe, expect, it } from 'vitest';
import type { CardLine, RunEndLine } from '@spark-outpost/contracts';
import {
  ONE_OFF_SESSION,
  addSplits,
  cardLine,
  costSplit,
  coveredMinutes,
  jevBand,
  jevLine,
  sessionLines,
  turnLine,
} from './decision-lines.ts';

const CLAUDE_PRICE = {
  provider: 'claude',
  model: 'sonnet',
  inputPerMillion: 3,
  cachedInputPerMillion: 0.3,
  outputPerMillion: 15,
  cacheOutsideInput: true,
  cacheWritePerMillion: 3.75,
};
const CODEX_PRICE = {
  provider: 'codex',
  model: 'gpt-6-sol',
  inputPerMillion: 2,
  cachedInputPerMillion: 0.2,
  outputPerMillion: 10,
};
const RUN = '0199b5a0-0000-7000-8000-000000000001';
const TURN = '0199b5a0-0000-7000-8000-000000000002';
const AT = new Date('2026-10-06T10:00:00.000Z');

describe('costSplit', () => {
  it('prices cache writes and reads apart from input when the provider reports them apart', () => {
    const split = costSplit(
      { input: 1_000_000, output: 100_000, cachedRead: 2_000_000, cachedWrite: 400_000 },
      CLAUDE_PRICE,
    );
    expect(split).toEqual({
      totalUsd: 6.6,
      inputUsd: 3,
      cacheWriteUsd: 1.5,
      cacheReadUsd: 0.6,
      outputUsd: 1.5,
      source: 'estimated',
    });
  });

  it('takes cached tokens out of input when the provider counts them inside it', () => {
    const split = costSplit(
      { input: 1_000_000, output: 0, cachedRead: 600_000, cachedWrite: 50_000 },
      CODEX_PRICE,
    );
    expect(split).toMatchObject({ inputUsd: 0.8, cacheReadUsd: 0.12, cacheWriteUsd: 0 });
  });

  it('says a run is unpriced instead of guessing', () => {
    const split = costSplit({ input: 10, output: 10, cachedRead: 0, cachedWrite: 0 }, null);
    expect(split).toMatchObject({ totalUsd: null, source: 'unpriced' });
    expect(addSplits([split])).toMatchObject({ totalUsd: null, source: 'unpriced' });
  });

  it('adds only the priced runs of a turn', () => {
    const priced = costSplit(
      { input: 1_000_000, output: 0, cachedRead: 0, cachedWrite: 0 },
      CLAUDE_PRICE,
    );
    const unpriced = costSplit({ input: 5, output: 5, cachedRead: 0, cachedWrite: 0 }, null);
    expect(addSplits([priced, unpriced, priced])).toMatchObject({ totalUsd: 6, inputUsd: 6 });
  });
});

describe('jevLine', () => {
  const row = {
    runId: RUN,
    childRunId: null,
    userMessageId: TURN,
    at: AT,
    purpose: 'intake',
    status: 'answered',
    inputTokens: 900,
    costUsd: 0.00004,
    policyVersion: 'intent-2',
  };

  it('lists the questions, the state size and the band, without the state itself', () => {
    const line = jevLine({
      ...row,
      body: {
        state: { task: 'Fix the typo' },
        questions: { intent: { type: 'choice' }, destructive: { type: 'noul' } },
        answers: { destructive: { type: 'noul', noul: 0.03 } },
        gate: { confidence: 0.91 },
        wouldApply: 'jev',
        jevModel: 'jev-1.13.0',
        latencyMs: 212,
      },
    });
    expect(line).toMatchObject({
      type: 'jev',
      questions: [
        { id: 'intent', type: 'choice' },
        { id: 'destructive', type: 'noul' },
      ],
      stateChars: JSON.stringify({ task: 'Fix the typo' }).length,
      confidence: 0.91,
      band: 'act',
      applied: 'jev',
      fallbackReason: null,
      latencyMs: 212,
      model: 'jev-1.13.0',
    });
    expect(JSON.stringify(line)).not.toContain('Fix the typo');
  });

  it('says why the rules decided', () => {
    expect(
      jevLine({ ...row, status: 'timed_out', body: { jevError: 'Jev timed out' } }),
    ).toMatchObject({ fallbackReason: 'Jev timed out', band: null, questions: [] });
    expect(
      jevLine({ ...row, body: { gate: { confidence: 0.5 }, wouldApply: 'rules' } }),
    ).toMatchObject({ fallbackReason: 'under the act line', band: 'unsure' });
    expect(jevLine({ ...row, status: 'not_connected', body: null })).toMatchObject({
      fallbackReason: 'not_connected',
      stateChars: 0,
    });
  });

  it('reads the bands at 0.8 and 0.2', () => {
    expect([0.8, 0.79, 0.21, 0.2, null].map(jevBand)).toEqual([
      'act',
      'unsure',
      'unsure',
      'no',
      null,
    ]);
  });
});

describe('sessionLines', () => {
  const opening = { runId: RUN, userMessageId: TURN, at: AT, provider: 'claude', model: 'sonnet' };
  const body = {
    event: 'resume',
    reason: 'continued',
    kept: true,
    provider: 'claude',
    agentKey: 'chat:do',
    sessionId: 's1',
    model: 'sonnet',
    carriedTokens: 1200,
    cacheWriteUsd: 0,
  };

  it('counts a run that opened a session nobody kept as a one-off open', () => {
    expect(sessionLines([], [opening])).toMatchObject([
      { event: 'open', reason: ONE_OFF_SESSION, kept: false, runId: RUN },
    ]);
  });

  it('prefers the recorded event of a run over its session/new request', () => {
    const recorded = { runId: RUN, userMessageId: TURN, at: AT, body };
    expect(sessionLines([recorded], [opening])).toMatchObject([{ event: 'resume', kept: true }]);
  });

  it('keeps closes that happened outside any run and drops rows it cannot read', () => {
    const closed = {
      runId: null,
      userMessageId: null,
      at: AT,
      body: { ...body, event: 'close', reason: 'idle' },
    };
    const broken = { runId: null, userMessageId: null, at: AT, body: { event: 'nonsense' } };
    expect(sessionLines([closed, broken], [])).toMatchObject([{ event: 'close', reason: 'idle' }]);
  });
});

describe('cards and turns', () => {
  const approval = {
    runId: RUN,
    userMessageId: TURN,
    kind: 'execute',
    title: 'Run pnpm test',
    status: 'allowed',
    reason: null,
    option: 'allow_once',
    createdAt: AT,
  };
  const later = (minutes: number) => new Date(AT.getTime() + minutes * 60_000);

  it('counts waiting only for cards a person saw', () => {
    const asked = cardLine({ ...approval, decidedBy: 'user', decidedAt: later(3) }, later(10));
    const byRule = cardLine(
      { ...approval, decidedBy: 'allowlist', decidedAt: later(3) },
      later(10),
    );
    const pending = cardLine({ ...approval, decidedBy: null, decidedAt: null }, later(10));
    expect(asked).toMatchObject({ shown: true, minutesWaited: 3 });
    expect(byRule).toMatchObject({ shown: false, minutesWaited: 0 });
    expect(pending).toMatchObject({ shown: true, minutesWaited: 10 });
  });

  it('does not count overlapping waits twice', () => {
    const cards: CardLine[] = [
      cardLine({ ...approval, decidedBy: 'user', decidedAt: later(4) }, later(10)),
      cardLine(
        { ...approval, createdAt: later(2), decidedBy: 'user', decidedAt: later(5) },
        later(10),
      ),
    ];
    expect(coveredMinutes(cards, later(10))).toBe(5);
  });

  it('redacts secrets in card titles', () => {
    const card = cardLine(
      {
        ...approval,
        title: 'curl -H "Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwx"',
        decidedBy: 'user',
        decidedAt: later(1),
      },
      later(2),
    );
    expect(card.title).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
  });

  it('rolls a turn up from its runs, sessions, Jev calls and cards', () => {
    const run = (
      ranAgent: boolean,
      attempt: number,
      tier: string | null,
    ): RunEndLine & { ranAgent: boolean } => ({
      type: 'run_end',
      runId: RUN,
      userMessageId: TURN,
      role: 'builder',
      attempt,
      status: 'succeeded',
      endReason: 'success',
      error: null,
      errorDetails: null,
      tier,
      cost: costSplit({ input: 1_000_000, output: 0, cachedRead: 0, cachedWrite: 0 }, CLAUDE_PRICE),
      ranAgent,
    });
    const line = turnLine(
      {
        userMessageId: TURN,
        at: AT,
        message: 'Use the key sk-ant-abcdefghijklmnopqrstuvwx to deploy',
        replyChars: 40,
        status: 'succeeded',
        includeText: true,
      },
      {
        runs: [run(false, 1, null), run(true, 1, 'mid'), run(true, 2, 'top')],
        sessions: sessionLines(
          [],
          [{ runId: RUN, userMessageId: TURN, at: AT, provider: 'claude', model: 'sonnet' }],
        ),
        jev: [],
        cards: [],
        escalations: 1,
      },
      later(1),
    );
    expect(line).toMatchObject({
      runs: 2,
      repeatRuns: 1,
      escalations: 1,
      sessions: { opened: 1, resumed: 0, replaced: 0, modelChanges: 0 },
      tiers: ['mid', 'top'],
      cost: { totalUsd: 9 },
      messageChars: 53,
    });
    expect(line.messageText).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
  });
});
