import { describe, expect, it } from 'vitest';
import { agentLabel, introLine, taskLine, TASK_EXCERPT_MAX } from '../src/outposts/handshake.ts';

describe('agentLabel', () => {
  it('names the agent and its model', () => {
    expect(agentLabel({ provider: 'Codex', model: 'GPT-5', auto: false })).toBe('Codex GPT-5');
  });

  it('says Auto when rules pick the model each turn', () => {
    expect(agentLabel({ provider: 'Claude', model: 'Opus', auto: true })).toBe('Claude Auto');
  });

  it('names the agent alone when no model is known', () => {
    expect(agentLabel({ provider: 'Claude', model: null, auto: false })).toBe('Claude');
  });
});

describe('introLine', () => {
  it('says who joined, where it works, with which agent and under which mode', () => {
    expect(
      introLine({ handle: 'api', project: 'api', agent: 'Codex GPT-5', mode: 'Approve for me' }),
    ).toBe('@api joined · api · Codex GPT-5 · Approve for me');
  });

  it('leaves out what is not known', () => {
    expect(introLine({ handle: 'fe', project: null, agent: 'Claude Auto', mode: null })).toBe(
      '@fe joined · Claude Auto',
    );
    expect(introLine({ handle: 'fe', project: null, agent: null, mode: null })).toBe('@fe joined');
  });

  it('never says the chats can ask each other', () => {
    const line = introLine({ handle: 'api', project: 'api', agent: 'Codex', mode: 'Auto' });
    expect(line).not.toMatch(/ask each other/);
  });
});

describe('taskLine', () => {
  it('quotes a short first message whole, on one line', () => {
    expect(taskLine('Add an optional userId filter.\nReturn 404 for an unknown user.')).toBe(
      'Task: Add an optional userId filter. Return 404 for an unknown user.',
    );
  });

  it('cuts a long first message at a word', () => {
    const line = taskLine('word '.repeat(60));
    expect(line.startsWith('Task: word word')).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThanOrEqual('Task: '.length + TASK_EXCERPT_MAX);
  });
});
