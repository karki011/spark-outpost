import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import {
  MID_BUILD_KEY,
  midBuildByRule,
  midBuildQuestions,
  readMidBuild,
} from './mid-build-question.ts';

function jev(choice: string, confidence: number): SystemOneResponse {
  return {
    model: 'jev-test',
    answers: { [MID_BUILD_KEY]: { type: 'choice', choice, confidence, probabilities: {} } },
  };
}

describe('the question asked about a message sent during a build', () => {
  it('is one choice over the message and the request being built', () => {
    const asked = midBuildQuestions('Also add a divide function', 'Build the math helpers');
    expect(Object.keys(asked.questions)).toEqual([MID_BUILD_KEY]);
    expect(Object.keys(asked.questions[MID_BUILD_KEY].criteria)).toEqual([
      'question',
      'requirement',
      'unrelated',
    ]);
    expect(asked.state).toEqual({
      task: 'Also add a divide function',
      build: 'Build the math helpers',
    });
  });
});

describe('readMidBuild', () => {
  it('acts on a confident Jev answer', () => {
    expect(readMidBuild('Use tabs', jev('requirement', 0.9))).toEqual({
      kind: 'requirement',
      source: 'jev',
      confidence: 0.9,
    });
  });

  it('falls back to rules when Jev is unsure or missing', () => {
    expect(readMidBuild('How far along are you?', jev('requirement', 0.5))).toEqual({
      kind: 'question',
      source: 'rules',
      confidence: 0.5,
    });
    expect(readMidBuild('How far along are you?', null).source).toBe('rules');
  });
});

describe('midBuildByRule', () => {
  it('reads an addition as a requirement and a question as a question', () => {
    expect(midBuildByRule('Also make sure divide throws on zero')).toBe('requirement');
    expect(midBuildByRule('What is P2 doing right now?')).toBe('question');
  });

  it('queues anything else rather than disturbing a worker', () => {
    expect(midBuildByRule('Rename the repo to tiny-maths')).toBe('unrelated');
  });
});
