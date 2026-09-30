import { describe, expect, it } from 'vitest';
import type { TaskPiece } from '@spark-outpost/contracts';
import { classifySteer } from './steer-rules.ts';

function piece(key: string, title: string, builderName: string | null): TaskPiece {
  return { key, title, builderName, dependsOn: [] } as unknown as TaskPiece;
}

const pieces = [
  piece('P1', 'Store', 'Bolt'),
  piece('P2', 'API', 'Rivet'),
  piece('P3', 'View', null),
];

function plan(text: string, target = 'auto') {
  const classified = classifySteer(text, target, pieces);
  if (!classified.ok) throw new Error(classified.error);
  return classified.plan;
}

describe('classifySteer', () => {
  it('routes a steer to the piece it names by key, title or Builder name', () => {
    expect(plan('P2 should return JSON')).toMatchObject({ kind: 'steer', target: 'P2' });
    expect(plan('the view needs a dark mode')).toMatchObject({ target: 'P3' });
    expect(plan('Rivet, keep the old route')).toMatchObject({ target: 'P2' });
    expect(plan('use UTC everywhere')).toMatchObject({ kind: 'steer', target: 'all' });
  });

  it('lets the picked target win over the words', () => {
    expect(plan('the view needs a dark mode', 'P1')).toMatchObject({ target: 'P1' });
    expect(plan('rename the report', 'coordinator')).toMatchObject({ target: 'coordinator' });
  });

  it('reads skip, stop, added requirements and provider moves', () => {
    expect(plan('skip the API piece')).toMatchObject({ kind: 'skip', target: 'P2' });
    expect(plan('Stop')).toMatchObject({ kind: 'stop', target: 'coordinator' });
    expect(plan('Also: the store keeps tags sorted')).toMatchObject({
      kind: 'requirement_added',
      target: 'P1',
      body: 'the store keeps tags sorted',
    });
    expect(plan('use Codex for the view')).toMatchObject({
      kind: 'reassign',
      target: 'P3',
      provider: 'codex',
      body: 'codex',
    });
    expect(plan('move Rivet to z.ai')).toMatchObject({ kind: 'reassign', provider: 'zai' });
  });

  it('asks which piece when a skip or a move names none', () => {
    expect(classifySteer('skip it', 'auto', pieces)).toEqual({
      ok: false,
      error: 'Say which piece, for example "skip P2" or pick it in To.',
    });
    expect(classifySteer('hello', 'P9', pieces)).toEqual({
      ok: false,
      error: 'There is no piece P9.',
    });
  });
});
