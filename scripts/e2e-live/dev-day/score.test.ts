import { describe, expect, it } from 'vitest';
import { anchorFor, pickPassage, quotedMessage } from './quotes.ts';
import { verdict } from './report-day.ts';
import { projectedRound } from './run-day.ts';
import { sessionCap } from './session-run.ts';
import {
  asksBack,
  classify,
  rank,
  scoreSession,
  summarise,
  type Evidence,
  type ScoredRun,
} from './score.ts';
import { SESSIONS, sessionById } from './sessions.ts';

function evidence(change: Partial<Evidence> = {}): Evidence {
  return {
    arm: 'direct-claude',
    changed: [],
    reply: '',
    reviewText: '',
    clarifyCard: false,
    planCard: false,
    planSaved: null,
    hidden: null,
    suite: null,
    timedOut: false,
    error: null,
    originalUntouched: null,
    roles: [],
    checksRan: 0,
    builderPlanLoaded: null,
    criticPlanLoaded: null,
    topTier: null,
    worktrees: 0,
    cardFirst: null,
    builders: 0,
    parallelBuilders: 0,
    handoff: null,
    resumed: null,
    draftPr: null,
    shipAvailable: null,
    pushedBranches: [],
    interventions: [],
    clicks: 0,
    ...change,
  };
}

const green = { tests: 3, pass: 3, fail: 0 };
const red = { tests: 3, pass: 1, fail: 2 };

describe('classify', () => {
  it('calls any edit a build', () => {
    expect(classify(evidence({ changed: ['a.ts'], reply: 'What do you mean?' }))).toBe('build');
  });

  it('tells a clarifying question from an offer at the end of an answer', () => {
    expect(asksBack('What should be faster: the page load, the scan, or the tests?')).toBe(true);
    expect(asksBack('It skips lockfiles in skip.ts. Want me to add a setting?')).toBe(false);
    expect(classify(evidence({ reply: 'Which part feels slow to you?' }))).toBe('clarify');
  });

  it('prefers the cards the harness showed', () => {
    expect(classify(evidence({ clarifyCard: true, reply: 'Done.' }))).toBe('clarify');
    expect(classify(evidence({ planCard: true, reply: 'Here it is.' }))).toBe('plan');
  });

  it('separates options from a plan and from an answer', () => {
    const options = '## Option 1: a panel\nPros: simple.\n## Option 2: a badge\nTrade-off: noisy.';
    expect(classify(evidence({ reply: options }))).toBe('options');
    const proCon =
      'A few ways to surface it:\n\n1. **A badge**\n   - Pro: cheap.\n   - Con: reactive.\n2. **A panel**\n   - Pro: proactive.\n   - Con: new backend.';
    expect(classify(evidence({ reply: proCon }))).toBe('options');
    const table =
      'Three ways to show them:\n\n| Option | What people see | Trade-off |\n| --- | --- | --- |\n| A note | counts | no paths |\n| A panel | paths | long lists |\n| A page | search | more UI |';
    expect(classify(evidence({ reply: table }))).toBe('options');
    const plan = '## Plan\n1. Add spend-csv.ts\n2. Add the button\n3. Test quoting';
    expect(classify(evidence({ reply: plan }))).toBe('plan');
    expect(classify(evidence({ reply: 'skipReason in skip.ts skips node_modules.' }))).toBe(
      'answer',
    );
  });
});

describe('scoreSession', () => {
  it('passes a question answered from the code without edits', () => {
    const score = scoreSession(
      sessionById('s01'),
      evidence({ reply: 'skipReason in skip.ts skips node_modules, lockfiles and binaries.' }),
    );
    expect(score.passed).toBe(true);
    expect(score.repairMinutes).toBe(0);
  });

  it('fails a question that edited files and charges the repair', () => {
    const session = sessionById('s01');
    const score = scoreSession(
      session,
      evidence({ changed: ['apps/server/src/codescan/skip.ts'], reply: 'skip.ts, node_modules' }),
    );
    expect(score.passed).toBe(false);
    expect(score.kind).toBe('build');
    expect(score.checks.find((check) => check.id === 'noEdits')?.ok).toBe(false);
    expect(score.repairMinutes).toBe(session.repairMinutes);
  });

  it('needs green hidden tests, a green suite and an in-scope diff for a build', () => {
    const session = sessionById('s05');
    const good = evidence({
      changed: ['apps/web/src/analytics/spend-summaries.ts'],
      hidden: green,
      suite: green,
    });
    expect(scoreSession(session, good).passed).toBe(true);
    expect(scoreSession(session, { ...good, hidden: red }).passed).toBe(false);
    const wide = { ...good, changed: [...good.changed, 'apps/server/src/api/app.ts'] };
    const scope = scoreSession(session, wide).checks.find((check) => check.id === 'scope');
    expect(scope?.ok).toBe(false);
  });

  it('requires the review to name both planted problems', () => {
    const session = sessionById('s07');
    const both =
      'plural() now says "0 run" for zero. median() never sorts and ignores even lengths.';
    expect(scoreSession(session, evidence({ reviewText: both, reply: both })).passed).toBe(true);
    const one = 'median() never sorts the values.';
    expect(scoreSession(session, evidence({ reviewText: one, reply: one })).passed).toBe(false);
  });

  it('fails when the read-only original changed', () => {
    const reply =
      'It lives in libs/foundations/design-system/knowledge; first classify the ticket.';
    const session = sessionById('s14');
    expect(scoreSession(session, evidence({ reply, originalUntouched: true })).passed).toBe(true);
    expect(scoreSession(session, evidence({ reply, originalUntouched: false })).passed).toBe(false);
  });

  it('counts a missing draft PR against the harness only once Ship exists', () => {
    const session = sessionById('s12');
    const built = { changed: ['src/api.ts'], hidden: green, suite: green };
    const absent = evidence({ ...built, arm: 'harness', shipAvailable: false });
    expect(scoreSession(session, absent).passed).toBe(true);
    const noPr = evidence({
      ...built,
      arm: 'harness',
      shipAvailable: true,
      draftPr: { opened: false, draft: false, branchPushed: false },
    });
    expect(scoreSession(session, noPr).passed).toBe(false);
    expect(scoreSession(session, evidence(built)).passed).toBe(true);
  });

  it('adds intervention minutes to the user time', () => {
    const score = scoreSession(
      sessionById('s04'),
      evidence({
        changed: ['apps/web/src/analytics/spend-csv.ts'],
        hidden: green,
        suite: green,
        interventions: [{ kind: 'paste', text: 'pasted the plan' }],
      }),
    );
    expect(score.passed).toBe(true);
    expect(score.userMinutes).toBe(1);
  });

  it('reports harness expectations without letting them decide the outcome', () => {
    const session = sessionById('s10');
    const score = scoreSession(
      session,
      evidence({
        arm: 'harness',
        changed: ['migrations/003_rename.sql'],
        hidden: green,
        suite: green,
        topTier: false,
        worktrees: 0,
        cardFirst: false,
      }),
    );
    expect(score.passed).toBe(true);
    expect(score.behaviors.map((behavior) => [behavior.id, behavior.ok])).toEqual([
      ['topTier', false],
      ['worktree', false],
      ['cardFirst', false],
    ]);
  });
});

function runs(arm: ScoredRun['arm'], passes: number, total: number, costUsd: number): ScoredRun[] {
  const session = sessionById('s06');
  return Array.from({ length: total }, (_, index) => ({
    arm,
    costUsd,
    wallMs: 1_000,
    interventions: 0,
    score: {
      kind: 'build' as const,
      checks: [],
      behaviors: [],
      passed: index < passes,
      repairMinutes: index < passes ? 0 : session.repairMinutes,
      userMinutes: index < passes ? 0 : session.repairMinutes,
    },
  }));
}

describe('ranking', () => {
  it('never puts a cheaper arm first when it passes less', () => {
    const all = [...runs('harness', 9, 10, 0.5), ...runs('direct-codex', 7, 10, 0.05)];
    const ranked = rank([summarise('harness', all), summarise('direct-codex', all)]);
    expect(ranked.map((summary) => summary.arm)).toEqual(['harness', 'direct-codex']);
    expect(verdict(ranked)).toMatch(/^harness leads on pass rate/);
  });

  it('breaks a pass-rate tie on cost per pass including repairs', () => {
    const all = [...runs('harness', 8, 10, 0.5), ...runs('direct-claude', 8, 10, 0.2)];
    const summary = summarise('direct-claude', all);
    expect(summary.userMinutes).toBe(20);
    expect(summary.trueCostUsd).toBeCloseTo(2 + (20 / 60) * 100);
    const ranked = rank([summarise('harness', all), summary]);
    expect(ranked[0]?.arm).toBe('direct-claude');
  });
});

describe('quotes', () => {
  const reply =
    'The scan lists files with git ls-files. skipReason in skip.ts drops node_modules, lockfiles and binaries.\nLarge files over 512 KB are skipped too.';

  it('picks the matching sentence and anchors it', () => {
    const passage = pickPassage(reply, /node_modules/);
    expect(passage).toBe('skipReason in skip.ts drops node_modules, lockfiles and binaries.');
    const anchor = anchorFor(reply, passage);
    expect(reply.slice(anchor.start, anchor.end)).toBe(passage);
    expect(anchor.prefix).toBe(reply.slice(anchor.start - 32, anchor.start));
  });

  it('falls back on an empty reply', () => {
    expect(pickPassage('', /x/)).toMatch(/empty/);
  });

  it('sends the passage as a quote block the way the composer does', () => {
    const message = quotedMessage('line one\nline two', 'Why?');
    expect(message).toBe('Comments on your previous reply:\n\n> line one\n> line two\n\nWhy?');
  });
});

describe('the day', () => {
  it('has fourteen ordered sessions whose continuations point backwards', () => {
    expect(SESSIONS.map((session) => session.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `s${String(index + 1).padStart(2, '0')}`),
    );
    const seen = new Set<string>();
    for (const session of SESSIONS) {
      for (const turn of session.turns) {
        if (turn.quote) expect(seen.has(turn.quote.fromSession)).toBe(true);
      }
      if (session.pastePlanFrom) expect(seen.has(session.pastePlanFrom)).toBe(true);
      seen.add(session.id);
    }
  });

  it('keeps the whole day inside the hard cap with the projection margin', () => {
    const arms = ['harness', 'direct-claude', 'direct-codex'] as const;
    const projected = SESSIONS.reduce((sum, session) => sum + projectedRound(session, arms), 0);
    expect(projected).toBeLessThan(25);
    expect(sessionCap(sessionById('s05'), 'direct-codex')).toBe(0.5);
  });
});
