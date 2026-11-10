import { describe, expect, it } from 'vitest';
import type { FeedbackItem, PrWatch } from '@spark-outpost/contracts';
import { followUpMode } from './use-watch-context.ts';
import { watch } from './watch-fixture.ts';
import {
  checkedLine,
  indicatorTitle,
  nextLine,
  roundWorker,
  watchIndicator,
  watchLabel,
  watchState,
  type IndicatorContext,
} from './watch-indicator-model.ts';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const ahead = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

const context = (fields: Partial<IndicatorContext> = {}): IndicatorContext => ({
  mode: 'on',
  worker: null,
  now: NOW,
  ...fields,
});

const item = (state: FeedbackItem['state']): FeedbackItem => ({
  id: '0190d7a0-0000-7000-8000-0000000000cc',
  label: 'F1',
  kind: 'review_comment',
  author: 'alice',
  trusted: true,
  path: null,
  line: null,
  excerpt: 'Please rename this.',
  url: null,
  triage: 'disagree',
  triagedBy: 'rules',
  state,
  round: null,
  reply: null,
});

const reviewed = (fields: Partial<PrWatch> = {}) => watch({ review: 'approved', ...fields });
const shown = (fields: Partial<PrWatch>, given: Partial<IndicatorContext> = {}) =>
  watchIndicator(watch(fields), context(given))!;

describe('what the watching indicator says', () => {
  it('says Spark is watching, when it last checked and when it checks next', () => {
    const indicator = shown({
      review: 'approved',
      lastPolledAt: ago(20),
      nextPollAt: ahead(100),
    });
    expect(indicator).toMatchObject({
      state: 'watching',
      label: 'Spark is watching',
      short: 'Watching',
      tone: 'quiet',
      watching: true,
      pulse: false,
      offer: null,
    });
    expect(indicatorTitle(indicator)).toBe(
      'Spark is watching. Spark is watching checks and reviews. Checked 20s ago · next check in 1 min.',
    );
  });

  it('waits for checks while they run and pulses only then', () => {
    const indicator = shown({ checks: 'pending', review: 'approved', lastPolledAt: ago(5) });
    expect(indicator).toMatchObject({
      state: 'waiting_checks',
      label: 'Waiting for checks',
      short: null,
      tone: 'live',
      pulse: true,
    });
    expect(indicator.lines).toContain('Checked just now.');
  });

  it('waits for review once checks are not running and nobody reviewed', () => {
    expect(watchState(watch({ checks: 'passing' }), 'on')).toBe('waiting_review');
    expect(watchState(watch({ checks: 'none' }), 'on')).toBe('waiting_review');
    expect(watchState(watch({ draft: true }), 'on')).toBe('watching');
    expect(watchState(watch({ checks: 'failing' }), 'on')).toBe('watching');
    expect(watchState(watch({ review: 'changes_requested' }), 'on')).toBe('watching');
    expect(shown({}).pulse).toBe(false);
  });

  it('names the round and who runs it while a follow-up round is running', () => {
    const indicator = shown(
      { phase: 'fixing', rounds: 2, checks: 'failing' },
      { worker: { agent: 'Claude', member: 'Builder' } },
    );
    expect(indicator).toMatchObject({
      state: 'agent',
      label: 'Agent is on it',
      short: 'Agent is on it',
      tone: 'live',
      pulse: true,
      lines: ['Claude · Builder is working on round 2.'],
    });
    expect(shown({ phase: 'fixing', rounds: 1 }).lines).toEqual([
      'The agent is working on round 1.',
    ]);
  });

  it('needs you for a waiting card and for items left to you', () => {
    expect(shown({ phase: 'confirming', rounds: 1 })).toMatchObject({
      state: 'needs_you',
      tone: 'warn',
      short: 'Needs you',
      pulse: false,
      lines: ['A card in this chat is waiting for you.'],
    });
    expect(shown({ phase: 'needs_you', items: [item('needs_user'), item('done')] })).toMatchObject({
      state: 'needs_you',
      short: null,
      lines: ['1 item is left for you.'],
    });
    expect(shown({ phase: 'needs_you', doing: 'The PR branch moved on GitHub.' }).lines).toEqual([
      'The PR branch moved on GitHub.',
    ]);
  });

  it('says why it is not watching when GitHub cannot be read', () => {
    const reason = 'GitHub is not connected for github.com, so Spark can’t read this pull request.';
    expect(
      shown({ unknownReason: reason, pollProblem: 'not_connected', nextPollAt: ahead(1800) }),
    ).toMatchObject({
      state: 'no_access',
      label: 'Not watching',
      short: 'Not watching',
      watching: false,
      tone: 'warn',
      lines: [reason, 'Spark tries again in 30 min.'],
    });
    expect(shown({ pollProblem: 'no_access' }).lines).toEqual([
      'Your GitHub connection can’t read this repository.',
    ]);
  });

  it('pauses on a rate limit, an unreachable GitHub or a failed check, with the error in brief', () => {
    expect(
      shown({ pollProblem: 'rate_limit', lastError: 'API rate limit', nextPollAt: ahead(900) }),
    ).toMatchObject({
      state: 'paused',
      label: 'Watching is paused',
      short: 'Paused',
      watching: false,
      pulse: false,
      lines: ['GitHub’s rate limit is used up.', 'Spark tries again in 15 min.'],
    });
    expect(shown({ pollProblem: 'offline', lastError: 'fetch failed' }).lines).toEqual([
      'Spark can’t reach GitHub.',
    ]);
    const long = shown({ pollProblem: 'error', lastError: `Boom\n${'x'.repeat(300)}` });
    expect(long.lines).toHaveLength(1);
    expect(long.lines[0]).toMatch(/^The last check failed: Boom x+…\.$/);
    expect(long.lines[0]).toHaveLength('The last check failed: .'.length + 120);
    expect(shown({ pollProblem: 'error', lastError: 'Bad gateway.' }).lines).toEqual([
      'The last check failed: Bad gateway.',
    ]);
    expect(shown({ pollProblem: 'error' }).lines).toEqual(['The last check failed.']);
  });

  it('says follow-up is off and offers the switch, only for a pull request Spark follows', () => {
    expect(shown({ review: 'approved', lastPolledAt: ago(90) }, { mode: 'off' })).toMatchObject({
      state: 'off',
      label: 'Follow-up is off',
      short: 'Follow-up off',
      watching: false,
      offer: 'follow_up',
    });
    expect(shown({ followUp: false, review: 'approved' }, { mode: 'off' })).toMatchObject({
      state: 'tracking',
      label: 'Spark is tracking',
      short: 'Tracking',
      watching: true,
      offer: null,
    });
  });

  it('keeps watching in ask-first, says so and offers that switch', () => {
    const indicator = shown({ review: 'approved' }, { mode: 'ask' });
    expect(indicator).toMatchObject({ state: 'watching', offer: 'ask' });
    expect(indicator.lines.at(-1)).toBe('Spark asks before pushing and replying.');
  });

  it('says follow-up stopped after a round that changed nothing, however many rounds ran', () => {
    expect(shown({ rounds: 7, review: 'approved' }).state).toBe('watching');
    expect(shown({ rounds: 1, quiet: true, review: 'approved' })).toMatchObject({
      state: 'stopped',
      label: 'Stopped following up',
      short: 'Stopped',
    });
    expect(shown({ quiet: true, phase: 'needs_you', items: [item('needs_user')] }).lines).toEqual([
      '1 item is left for you.',
      'The last round changed nothing, so Spark stopped following up. New feedback or a new commit starts it again, or ask in the chat for another round.',
    ]);
  });

  it('shows nothing once the pull request is merged or closed', () => {
    expect(watchIndicator(watch({ prState: 'merged', phase: 'done' }), context())).toBeNull();
    expect(watchIndicator(watch({ prState: 'closed', phase: 'done' }), context())).toBeNull();
    expect(watchLabel(watch({ prState: 'merged' }), 'on')).toBeNull();
    expect(watchLabel(reviewed(), 'on')).toBe('Spark is watching');
  });
});

describe('which state wins when several apply', () => {
  const everything: Partial<PrWatch> = {
    checks: 'pending',
    quiet: true,
    pollProblem: 'rate_limit',
    unknownReason: 'No access.',
    items: [item('needs_user')],
  };

  it('ranks a running round, then you, then access, a pause, off, stopped, checks, review', () => {
    const order: [Partial<PrWatch>, string][] = [
      [{ phase: 'fixing' }, 'agent'],
      [{}, 'needs_you'],
      [{ items: [] }, 'no_access'],
      [{ items: [], unknownReason: null }, 'paused'],
      [{ items: [], unknownReason: null, pollProblem: null }, 'off'],
    ];
    for (const [fields, state] of order) {
      expect(watchState(watch({ ...everything, ...fields }), 'off')).toBe(state);
    }
    const quiet = { items: [], unknownReason: null, pollProblem: null };
    expect(watchState(watch({ ...everything, ...quiet }), 'on')).toBe('stopped');
    expect(watchState(watch({ ...everything, ...quiet, quiet: false }), 'on')).toBe(
      'waiting_checks',
    );
    expect(watchState(watch({ ...quiet, checks: 'passing' }), 'on')).toBe('waiting_review');
    expect(watchState(watch({ ...everything, prState: 'merged', phase: 'fixing' }), 'on')).toBe(
      null,
    );
  });

  it('keeps status-only pull requests out of off and stopped', () => {
    const unfollowed = watch({ followUp: false, quiet: true, review: 'approved' });
    expect(watchState(unfollowed, 'off')).toBe('tracking');
    expect(watchState({ ...unfollowed, checks: 'pending' }, 'off')).toBe('waiting_checks');
  });
});

describe('times', () => {
  it('rounds the last check to ten seconds, then minutes and hours', () => {
    expect(checkedLine({ lastPolledAt: null }, NOW)).toBe('Not checked yet');
    expect(checkedLine({ lastPolledAt: ago(3) }, NOW)).toBe('Checked just now');
    expect(checkedLine({ lastPolledAt: ago(-4) }, NOW)).toBe('Checked just now');
    expect(checkedLine({ lastPolledAt: ago(29) }, NOW)).toBe('Checked 20s ago');
    expect(checkedLine({ lastPolledAt: ago(150) }, NOW)).toBe('Checked 2 min ago');
    expect(checkedLine({ lastPolledAt: ago(2 * 3600 + 5) }, NOW)).toBe('Checked 2 h ago');
  });

  it('says when the next check is due, or nothing when none is planned', () => {
    expect(nextLine({ nextPollAt: null }, NOW)).toBeNull();
    expect(nextLine({ nextPollAt: ahead(45) }, NOW)).toBe('next check in 40s');
    expect(nextLine({ nextPollAt: ahead(600) }, NOW)).toBe('next check in 10 min');
    expect(nextLine({ nextPollAt: ago(30) }, NOW)).toBe('next check any moment now');
  });
});

describe('who runs the round', () => {
  const runs = [{ id: 'a', provider: 'claude' }];
  const member = (fields: Record<string, unknown>) => ({
    role: 'builder' as const,
    name: 'Bolt',
    provider: 'claude',
    status: 'running' as const,
    ...fields,
  });
  const name = (provider: string) => provider.toUpperCase();

  it('names the agent of the round run, and the crew member working right now', () => {
    expect(roundWorker({ runs }, 'a', name)).toEqual({ agent: 'CLAUDE', member: null });
    const crew = [
      member({ status: 'succeeded' }),
      member({ role: 'critic', name: 'Hawk', provider: 'codex' }),
    ];
    expect(roundWorker({ runs, orchestrations: { a: { crew } } }, 'a', name)).toEqual({
      agent: 'CODEX',
      member: 'Hawk · Critic',
    });
    const done = [member({ status: 'succeeded' })];
    expect(roundWorker({ runs, orchestrations: { a: { crew: done } } }, 'a', name)).toEqual({
      agent: 'CLAUDE',
      member: null,
    });
  });

  it('names nobody when the run is not known', () => {
    expect(roundWorker({ runs }, null, name)).toBeNull();
    expect(roundWorker({ runs }, 'missing', name)).toBeNull();
    expect(roundWorker(undefined, 'a', name)).toBeNull();
  });
});

describe('the follow-up mode from the profile', () => {
  it('is on until the profile says otherwise', () => {
    expect(followUpMode(null)).toBe('on');
    expect(followUpMode({ prFollowUp: true, prFollowUpAsk: false })).toBe('on');
    expect(followUpMode({ prFollowUp: true, prFollowUpAsk: true })).toBe('ask');
    expect(followUpMode({ prFollowUp: false, prFollowUpAsk: true })).toBe('off');
  });
});
