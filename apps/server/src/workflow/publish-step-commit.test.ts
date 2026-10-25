import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnDeps, TurnResult } from './agent-turn.ts';
import type { SecondPrompt } from './publish-step-again.ts';
import { commitWithoutRemote } from './publish-step-commit.ts';

const { git, again } = vi.hoisted(() => ({ git: vi.fn(), again: vi.fn() }));
vi.mock('../ship/git.ts', () => ({ runGit: git }));
vi.mock('./publish-step-again.ts', () => ({ promptAgain: again }));
vi.mock('./execute-run.ts', () => ({ closeMessage: vi.fn() }));

const reply: TurnResult = { outcome: 'succeeded', error: null, text: 'Built.', messageId: 'first' };

function turn(signal = new AbortController().signal) {
  return {
    reply,
    append: vi.fn(async () => null),
    control: { signal },
  } as unknown as SecondPrompt & { reply: TurnResult };
}

beforeEach(() => {
  vi.clearAllMocks();
  git.mockResolvedValue({ code: 0, stdout: 'abc1234', stderr: '' });
  again.mockResolvedValue({ ...reply, text: '', messageId: 'second' });
});

describe('agent-owned local publishing', () => {
  it('never starts the continuation after a host stop', async () => {
    const control = new AbortController();
    control.abort();
    expect(
      await commitWithoutRemote(
        {} as TurnDeps,
        turn(control.signal),
        '/repo',
        'topic',
        'full-auto',
      ),
    ).toBe(reply);
    expect(again).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'failed', 'lease_lost'] as const)(
    'does no fallback write after %s',
    async (outcome) => {
      const stopped = { ...reply, outcome, text: '', error: null };
      again.mockResolvedValue(stopped);
      const result = await commitWithoutRemote(
        {} as TurnDeps,
        turn(),
        '/repo',
        'topic',
        'full-auto',
      );
      expect(git.mock.calls).toEqual([['/repo', ['rev-parse', '--verify', 'HEAD']]]);
      if (outcome === 'lease_lost') expect(result).toBe(stopped);
      else {
        expect(result.text).toContain(outcome === 'cancelled' ? 'was stopped' : 'failed');
        expect(result.text).not.toContain('Committed');
      }
    },
  );

  it('does not attribute a changed HEAD to the expected branch after a checkout switch', async () => {
    git.mockResolvedValueOnce({ code: 0, stdout: 'abc1234' });
    git.mockResolvedValueOnce({ code: 0, stdout: 'def5678' });
    git.mockResolvedValueOnce({ code: 0, stdout: 'other' });
    const result = await commitWithoutRemote({} as TurnDeps, turn(), '/repo', 'topic', 'full-auto');
    expect(result.text).toContain(
      'HEAD changed to def5678, but the chat branch could not be confirmed',
    );
    expect(result.text).not.toContain('on topic');
  });
});
