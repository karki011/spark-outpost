import { describe, expect, it } from 'vitest';
import type { SparkActivity } from '@spark-outpost/contracts';
import {
  activityLine,
  countLabel,
  defaultSparkHint,
  totalsLine,
  wordsLabel,
} from './spark-usage-model.ts';

const NOW = Date.parse('2026-11-22T12:00:00Z');

describe('countLabel', () => {
  it('counts each kind in words', () => {
    expect(countLabel('chat', 1)).toBe('1 chat');
    expect(countLabel('job', 3)).toBe('3 @ jobs');
    expect(countLabel('step', 0)).toBe('0 workflow steps');
  });
});

describe('totalsLine', () => {
  it('says when something was never used', () => {
    expect(totalsLine({ count: 0, lastAt: null, tokens: 0, costUsd: null }, NOW)).toBe(
      'Not used yet',
    );
  });

  it('gives the last use, tokens and cost, leaving out what is unknown', () => {
    const lastAt = '2026-11-22T10:00:00Z';
    expect(totalsLine({ count: 2, lastAt, tokens: 12_400, costUsd: 0.4 }, NOW)).toBe(
      'last 2 h ago · 12.4K tokens · $0.40',
    );
    expect(totalsLine({ count: 2, lastAt, tokens: 0, costUsd: null }, NOW)).toBe('last 2 h ago');
  });
});

describe('activityLine', () => {
  const entry: SparkActivity = {
    id: '0b8e7f4c-1d2a-4e5b-8c9d-0a1b2c3d4e5f',
    kind: 'step',
    conversationId: null,
    title: 'Risk review',
    workflowName: 'Risk review',
    status: 'failed',
    at: '2026-11-22T11:30:00Z',
    tokens: 900,
    costUsd: null,
  };

  it('names the kind, the workflow, the status in words and the time', () => {
    expect(activityLine(entry, NOW)).toBe(
      'Workflow step in Risk review · Failed · 30 min ago · 900 tokens',
    );
  });

  it('leaves the status out for a chat with no turn', () => {
    expect(
      activityLine({ ...entry, kind: 'chat', workflowName: null, status: null, tokens: 0 }, NOW),
    ).toBe('Chat · 30 min ago');
  });
});

describe('wordsLabel', () => {
  it('counts words', () => {
    expect(wordsLabel('')).toBe('0 words');
    expect(wordsLabel(' One ')).toBe('1 word');
    expect(wordsLabel('Name the file\nand line.')).toBe('5 words');
  });
});

describe('defaultSparkHint', () => {
  const pip = { id: 'a', name: 'Pip' };

  it('names the Spark new chats use now', () => {
    expect(defaultSparkHint(pip, null)).toContain('Now: no Spark.');
    expect(defaultSparkHint(pip, pip)).toContain('Now: Pip.');
    expect(defaultSparkHint(pip, { id: 'b', name: 'Orchestrator' })).toContain(
      'Now: Orchestrator.',
    );
  });
});
