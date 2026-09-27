import { describe, expect, it } from 'vitest';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import {
  buildRouteQuestions,
  buildTransitionQuestions,
  offeredNext,
  parseRouteAnswers,
  parseTransitionAnswers,
  redactPaths,
  type TransitionFacts,
} from './jev-questions.ts';

const candidate: AdvisorCandidate = {
  provider: 'claude',
  name: 'Claude',
  models: [
    { id: 'haiku', label: 'Haiku 4.5', description: null },
    { id: 'sonnet', label: 'Sonnet 5', description: null },
  ],
  efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null })),
};

const facts: TransitionFacts = {
  task: 'Fix it',
  role: 'builder',
  step: 'Edit src/app.ts',
  outcome: 'succeeded',
  reply: 'Changed /Users/me/app/src/app.ts and config.json',
  stepsLeft: 0,
  retriesLeft: 2,
  reviewed: false,
  verdict: null,
  findings: 0,
  filesChanged: 1,
  toolCalls: 3,
};

describe('routing questions', () => {
  it('asks one model and effort per slot, with paths removed from the step', () => {
    const asked = buildRouteQuestions('Fix it', [
      { key: 'builder_0', role: 'builder', step: 'Edit src/app.ts', candidate },
    ]);
    expect(Object.keys(asked.state)).toEqual(['task', 'work']);
    expect(asked.state.work).toEqual({ builder_0: 'Builder: Edit [path]' });
    expect(Object.keys(asked.questions)).toEqual(['model_builder_0', 'effort_builder_0']);
  });

  it('rejects a model that was not offered', () => {
    const slots = [{ key: 'builder_0', role: 'builder' as const, step: null, candidate }];
    const answer = (choice: string) => ({
      model: 'jev',
      answers: {
        model_builder_0: { type: 'choice' as const, choice, probabilities: {}, confidence: 0.9 },
        effort_builder_0: { type: 'score' as const, score: 2, confidence: 0.9 },
      },
    });
    expect(parseRouteAnswers(slots, answer('sonnet')).get('builder_0')).toMatchObject({
      model: { id: 'sonnet' },
      effort: 'high',
      confidence: 0.9,
    });
    expect(() => parseRouteAnswers(slots, answer('opus'))).toThrow('not offered');
  });
});

describe('transition questions', () => {
  it('pins the state keys sent and removes paths from the reply', () => {
    const asked = buildTransitionQuestions(facts);
    expect(Object.keys(asked.state)).toEqual([
      'task',
      'role',
      'step',
      'outcome',
      'reply',
      'stepsLeft',
      'retriesLeft',
      'verdict',
      'findings',
      'filesChanged',
      'toolCalls',
    ]);
    expect(asked.state.reply).toBe('Changed [path] and [path]');
    expect(redactPaths('see ./a/b.ts')).toBe('see [path]');
  });

  it('sends counts as named buckets, never raw numbers', () => {
    const asked = buildTransitionQuestions({
      ...facts,
      stepsLeft: 3,
      retriesLeft: 1,
      findings: 4,
      filesChanged: 7,
      toolCalls: 12,
    });
    expect(asked.state).toMatchObject({
      stepsLeft: 'several more steps',
      retriesLeft: 'one left',
      findings: 'many',
      filesChanged: 'many files',
      toolCalls: 'many',
    });
    expect(buildTransitionQuestions(facts).state).toMatchObject({
      stepsLeft: 'this was the last step',
      retriesLeft: 'several left',
      findings: 'none',
      filesChanged: 'one file',
      toolCalls: 'a few',
    });
    for (const value of Object.values(asked.state)) expect(typeof value).not.toBe('number');
  });

  it('describes quality and effort levels as situations, not degrees', () => {
    const quality = buildTransitionQuestions(facts).questions.quality!.criteria as {
      what: string;
    }[];
    expect(quality).toHaveLength(5);
    const degrees = /\b(poor|fair|good|excellent|unusable|low|medium|high)\b/i;
    for (const level of quality) expect(level.what).not.toMatch(degrees);
    const routed = buildRouteQuestions('Fix it', [
      { key: 'builder_0', role: 'builder', step: null, candidate },
    ]);
    const efforts = routed.questions.effort_builder_0!.criteria as {
      effort: string;
      when: string;
    }[];
    expect(efforts.map((level) => level.effort)).toEqual(['low', 'medium', 'high']);
    for (const level of efforts) expect(level.when).not.toMatch(degrees);
  });

  it('offers only the next steps that are possible', () => {
    expect(offeredNext(facts)).toEqual(['retry_up', 'review', 'finish']);
    expect(offeredNext({ ...facts, stepsLeft: 2, retriesLeft: 0, reviewed: true })).toEqual([
      'next_step',
      'finish',
    ]);
  });

  it('takes the weaker confidence of status and next, and rejects what was not offered', () => {
    const response = (next: string) => ({
      model: 'jev',
      answers: {
        status: { type: 'choice' as const, choice: 'done', probabilities: {}, confidence: 0.95 },
        quality: { type: 'score' as const, score: 3.4, confidence: 0.7 },
        next: { type: 'choice' as const, choice: next, probabilities: {}, confidence: 0.8 },
      },
    });
    expect(parseTransitionAnswers(facts, response('finish'))).toEqual({
      status: 'done',
      next: 'finish',
      quality: 3.4,
      confidence: 0.8,
    });
    expect(() => parseTransitionAnswers(facts, response('next_step'))).toThrow('not offered');
  });
});
