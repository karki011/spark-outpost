import { describe, expect, it } from 'vitest';
import { terminalApprovals } from './approvals.ts';

const request = {
  conversationId: 'c1',
  provider: 'claude' as const,
  tool: 'Bash',
  detail: 'npm test',
};

describe('terminal approvals', () => {
  it('hands a decision to the waiting hook once, then forgets it', async () => {
    const approvals = terminalApprovals();
    const waiting = approvals.wait(request, {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    const shown = approvals.current('c1')!;
    expect(shown).toMatchObject({ tool: 'Bash', detail: 'npm test' });
    approvals.take('c1', shown.id)!.settle({ behavior: 'deny', message: 'Use pnpm' });
    await expect(waiting).resolves.toEqual({ behavior: 'deny', message: 'Use pnpm' });
    expect(approvals.current('c1')).toBeNull();
    expect(approvals.take('c1', shown.id)).toBeNull();
  });

  it('refuses a decision for an approval that is no longer the open one', async () => {
    const approvals = terminalApprovals();
    const first = approvals.wait(request, {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    const old = approvals.current('c1')!.id;
    const second = approvals.wait(request, {
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    await expect(first).resolves.toBeNull();
    expect(approvals.take('c1', old)).toBeNull();
    approvals.clear('c1');
    await expect(second).resolves.toBeNull();
  });

  it('ends the wait when the hook goes away or its time runs out', async () => {
    const approvals = terminalApprovals();
    const gone = new AbortController();
    const aborted = approvals.wait(request, { signal: gone.signal, timeoutMs: 10_000 });
    gone.abort();
    await expect(aborted).resolves.toBeNull();
    expect(approvals.current('c1')).toBeNull();
    const timed = approvals.wait(request, { signal: new AbortController().signal, timeoutMs: 5 });
    await expect(timed).resolves.toBeNull();
    expect(approvals.current('c1')).toBeNull();
  });

  it('keeps a Codex approval open until it is taken or cleared', () => {
    const approvals = terminalApprovals();
    const entry = approvals.note({ ...request, provider: 'codex' });
    expect(approvals.current('c1')?.id).toBe(entry.id);
    approvals.clear('c1');
    expect(approvals.current('c1')).toBeNull();
  });
});
