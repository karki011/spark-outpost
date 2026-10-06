import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { crewItems, mergeApprovals, mergeCheckpoints } from '../crew/crew-items.ts';
import { member } from '../../crew/test-orchestration.ts';
import {
  autoLabel,
  changesSummary,
  checkpointQuestion,
  clarifyAnswer,
  NO_ANSWER,
  quickPicks,
  sentAnswers,
  togglePick,
  checkpointResult,
  checkpointTitle,
  isCheckpoint,
  retryLine,
  saidNote,
  secondsLeft,
  waitingLabel,
} from './checkpoint-model.ts';

const opus = { provider: 'claude', model: 'opus-5.5', modelLabel: 'Opus 5.5', effort: 'high' };
const sonnet = { provider: 'claude', model: 'sonnet-5', modelLabel: 'Sonnet 5', effort: 'medium' };

describe('checkpoint wording', () => {
  it('suggests the escalated model for a retry', () => {
    const payload = checkpoint({ kind: 'retry', from: sonnet, to: opus }).payload.checkpoint!;
    expect(retryLine(payload)).toBe('Retry with Opus 5.5 · high?');
    expect(retryLine({ ...payload, to: sonnet })).toBe('Retry the step once more?');
  });

  it('names the agent that needs your input', () => {
    const payload = checkpoint({ kind: 'clarify', agent: 'Bolt' }).payload.checkpoint!;
    expect(checkpointTitle(payload)).toBe('Bolt needs your input');
    expect(waitingLabel(payload)).toBe('Answer Bolt');
    expect(checkpointTitle({ ...payload, agent: null })).toBe('Jev has a question');
  });

  it('titles the crew’s clarifying questions as Spark’s', () => {
    const payload = checkpoint({
      kind: 'clarify',
      agent: 'Pip',
      question: 'A few questions first',
      questions: [{ question: 'Which report?', options: [], default: 'Spend' }],
    }).payload.checkpoint!;
    expect(checkpointTitle(payload)).toBe('Spark has a few questions');
    expect(checkpointQuestion(payload)).toBeNull();
    expect(waitingLabel(payload)).toBe('Answer Spark’s questions');
  });

  it('offers the best guess first among the quick answers', () => {
    expect(
      quickPicks({ question: 'Which?', options: ['Usage', 'Spend'], default: 'Spend' }),
    ).toEqual(['Spend', 'Usage']);
  });

  it('sends only the questions answered, then the own words', () => {
    const questions = [
      { question: 'Which report?', options: [], default: 'Spend' },
      { question: 'Which period?', options: [], default: 'This month' },
    ];
    const typed = (text: string) => ({ picks: [], text });
    expect(clarifyAnswer(questions, [NO_ANSWER, typed(' Last year ')], '')).toBe(
      'Which period? → Last year',
    );
    expect(clarifyAnswer(questions, [typed('Usage'), NO_ANSWER], ' keep it short ')).toBe(
      'Which report? → Usage\nkeep it short',
    );
    expect(clarifyAnswer(questions, [NO_ANSWER, NO_ANSWER], '  ')).toBe('');
    expect(clarifyAnswer(questions, [], '')).toBe('');
  });

  it('joins several picked answers in the order offered, then what was typed', () => {
    const questions = [
      { question: 'Which area?', options: ['Explorer', 'Views'], default: 'Pulse' },
      { question: 'How deep?', options: ['Quick summary'], default: 'Walkthrough' },
    ];
    const both = togglePick(togglePick(NO_ANSWER, 'Explorer'), 'Pulse');
    expect(both.picks).toEqual(['Explorer', 'Pulse']);
    expect(clarifyAnswer(questions, [both, NO_ANSWER], '')).toBe('Which area? → Pulse, Explorer');
    expect(
      clarifyAnswer(questions, [{ ...both, text: ' focus on tests\nand docs ' }, NO_ANSWER], ''),
    ).toBe('Which area? → Pulse, Explorer — plus: focus on tests and docs');
    expect(togglePick(both, 'Explorer').picks).toEqual(['Pulse']);
    expect(clarifyAnswer(questions, [togglePick(both, 'Pulse'), NO_ANSWER], 'go')).toBe(
      'Which area? → Explorer\ngo',
    );
  });

  it('reads the sent answers back per question, leaving the own words', () => {
    const questions = [
      { question: 'Which area?', options: ['Explorer'], default: 'Pulse' },
      { question: 'How deep?', options: [], default: 'Walkthrough' },
    ];
    const note = 'Which area? → Pulse, Explorer — plus: tests\nkeep it short\nand plain';
    expect(sentAnswers(questions, note)).toEqual({
      answers: ['Pulse, Explorer — plus: tests', null],
      ownWords: 'keep it short\nand plain',
    });
    expect(sentAnswers(questions, null)).toEqual({ answers: [null, null], ownWords: '' });
    const twice = [questions[1]!, questions[1]!];
    expect(sentAnswers(twice, 'How deep? → A\nHow deep? → B').answers).toEqual(['A', 'B']);
  });

  it('quotes only the own words on an answered question card', () => {
    const questions = [{ question: 'Which area?', options: [], default: 'Pulse' }];
    const answered = (note: string, decisionOptionId: string) => ({
      ...checkpoint({ kind: 'clarify', questions }),
      status: 'allowed' as const,
      decisionOptionId,
      note,
    });
    const note = 'Which area? → Views\nkeep it short';
    expect(saidNote(answered(note, CHECKPOINT_OPTION.answer))).toBe('keep it short');
    expect(saidNote(answered('Which area? → Views', CHECKPOINT_OPTION.answer))).toBeNull();
    expect(saidNote(answered(note, CHECKPOINT_OPTION.stop))).toBe(note);
    expect(
      saidNote({
        ...answered(note, CHECKPOINT_OPTION.answer),
        payload: checkpoint({ kind: 'clarify' }).payload,
      }),
    ).toBe(note);
  });

  it('does not repeat the title as the question', () => {
    const keep = checkpoint({ kind: 'accept', question: 'Keep these changes?' }).payload
      .checkpoint!;
    expect(checkpointTitle(keep)).toBe('Keep these changes?');
    expect(checkpointQuestion(keep)).toBeNull();
    const stuck = checkpoint({
      kind: 'stuck',
      agent: 'Bolt',
      question: 'Continue, or stop and report?',
    }).payload.checkpoint!;
    expect(checkpointTitle(stuck)).toBe('Bolt was repeating itself');
    expect(checkpointQuestion(stuck)).toBe('Continue, or stop and report?');
  });

  it('counts down the default answer from the server deadline', () => {
    expect(autoLabel(CHECKPOINT_OPTION.stopReport, 10)).toBe('Stop and report (10s)');
    expect(autoLabel(CHECKPOINT_OPTION.clarifyRules, 3)).toBe('Continue (3s)');
    expect(autoLabel(CHECKPOINT_OPTION.useDefaults, 5)).toBe('Going with my best guesses in 5s');
    const at = '2026-09-26T10:00:10.000Z';
    expect(secondsLeft(at, Date.parse('2026-09-26T10:00:00.200Z'))).toBe(10);
    expect(secondsLeft(at, Date.parse('2026-09-26T10:00:11.000Z'))).toBe(0);
  });

  it('says when a question continued on its own', () => {
    const auto = checkpoint(
      { kind: 'retry' },
      {
        status: 'denied',
        decidedBy: 'auto',
        decisionOptionId: CHECKPOINT_OPTION.stopReport,
        createdAt: '2026-09-26T10:00:00.000Z',
        autoContinueAt: '2026-09-26T10:00:10.000Z',
      },
    );
    expect(checkpointResult(auto)).toBe('Continued automatically after 10s.');
    const guessed = checkpoint(
      { kind: 'clarify' },
      {
        status: 'allowed',
        decidedBy: 'auto',
        decisionOptionId: CHECKPOINT_OPTION.useDefaults,
        createdAt: '2026-09-26T10:00:00.000Z',
        autoContinueAt: '2026-09-26T10:00:10.000Z',
      },
    );
    expect(checkpointResult(guessed)).toBe('Went with the best guesses after 10s.');
  });

  it('reads an old budget card back as a plain answered record', () => {
    const old = checkpoint({ kind: 'budget' }, { status: 'allowed', decisionOptionId: 'continue' });
    expect(checkpointTitle(old.payload.checkpoint!)).toBe('Paused at a budget');
    expect(checkpointResult(old)).toBe('Answered.');
  });

  it('reads back the decision', () => {
    const clarify = checkpoint(
      { kind: 'clarify', choices: ['Local time', 'UTC'] },
      { status: 'allowed', decisionOptionId: 'option:1' },
    );
    expect(checkpointResult(clarify)).toBe('You chose: UTC');
    const retry = checkpoint(
      { kind: 'retry' },
      { status: 'denied', decisionOptionId: CHECKPOINT_OPTION.stopReport },
    );
    expect(checkpointResult(retry)).toBe('Stopped and reported.');
    expect(checkpointResult(checkpoint({ kind: 'accept' }, { status: 'expired' }))).toBe(
      'Expired before you answered.',
    );
  });

  it('says which choice kept the changes by itself', () => {
    const kept = {
      status: 'allowed' as const,
      decidedBy: 'level' as const,
      decisionOptionId: 'keep',
    };
    expect(checkpointResult(checkpoint({ kind: 'accept', keptBy: 'full-auto' }, kept))).toBe(
      'Kept by Full auto → PR.',
    );
    expect(checkpointResult(checkpoint({ kind: 'accept', keptBy: 'hands-off' }, kept))).toBe(
      'Kept automatically.',
    );
  });

  it('titles the risky-change card and reports its approval', () => {
    const risky = checkpoint({ kind: 'plan', question: 'Start this risky change?' });
    expect(checkpointTitle(risky.payload.checkpoint!)).toBe('Start this risky change?');
    expect(waitingLabel(risky.payload.checkpoint!)).toBe('Build it, or stop');
    const approved = checkpoint(
      { kind: 'plan' },
      { status: 'allowed', decisionOptionId: CHECKPOINT_OPTION.makeChange },
    );
    expect(checkpointResult(approved)).toBe('Making the change.');
    const plan = checkpoint({ kind: 'plan', question: 'Approve the plan?' });
    expect(checkpointTitle(plan.payload.checkpoint!)).toBe('Approve the plan?');
    expect(waitingLabel(plan.payload.checkpoint!)).toBe('Approve the plan');
  });
});

describe('the keep card summary', () => {
  it('names the files and, when known, the changed lines', () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      change: 'modified' as const,
    }));
    expect(changesSummary({ files, lines: { added: 340, removed: 21 } })).toBe(
      '12 files · +340 −21',
    );
    expect(changesSummary({ files: files.slice(0, 1), lines: null })).toBe('1 file');
  });
});

describe('checkpoints in the turn', () => {
  it('keeps the decided copy of a checkpoint and ignores tool approvals', () => {
    const pending = checkpoint({ kind: 'accept' });
    const decided = { ...pending, status: 'allowed' as const, decisionOptionId: 'keep' };
    const tool = {
      ...pending,
      id: '00000000-0000-4000-8000-0000000000c9',
      kind: 'execute' as const,
    };
    const merged = mergeCheckpoints([decided], [pending, tool]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('allowed');
    expect(isCheckpoint(tool)).toBe(false);
  });

  it('places run-level checkpoints between the agents by time', () => {
    const scout = member({ runId: '00000000-0000-4000-8000-0000000000b1', role: 'builder' });
    const builder = member({ startedAt: '2026-09-26T10:04:00.000Z' });
    const queued = member({
      runId: '00000000-0000-4000-8000-0000000000b3',
      role: 'critic',
      startedAt: null,
      status: 'queued',
    });
    const plan = checkpoint({ kind: 'clarify' }, { createdAt: '2026-09-26T10:03:30.000Z' });
    const own = checkpoint({ kind: 'accept' }, { id: 'x', runId: builder.runId });
    const items = crewItems([scout, builder, queued], mergeCheckpoints([plan, own]));
    expect(items.map((item) => item.kind)).toEqual(['agent', 'checkpoint', 'agent', 'agent']);
    expect(items[2]).toMatchObject({ kind: 'agent', checkpoints: [own] });
  });

  it('places check approvals between the agents by time', () => {
    const builder = member({ startedAt: '2026-09-26T10:03:00.000Z' });
    const fix = member({
      runId: '00000000-0000-4000-8000-0000000000b4',
      startedAt: '2026-09-26T10:06:00.000Z',
    });
    const check = {
      ...checkpoint({ kind: 'accept' }),
      id: '00000000-0000-4000-8000-0000000000c7',
      toolCallId: 'check:1',
      kind: 'execute' as const,
      createdAt: '2026-09-26T10:05:00.000Z',
    };
    const items = crewItems([builder, fix], [], mergeApprovals([check], [check]));
    expect(items.map((item) => item.kind)).toEqual(['agent', 'approval', 'agent']);
  });
});
