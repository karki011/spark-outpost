import type { Approval } from '@spark-outpost/contracts';
import { getApproval } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';

export class ApprovalWaiters {
  private readonly waiting = new Map<string, Set<() => void>>();

  notify(approvalId: string): void {
    const wakers = this.waiting.get(approvalId);
    if (!wakers) return;
    this.waiting.delete(approvalId);
    wakers.forEach((wake) => wake());
  }

  wait(approvalId: string, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wakers = this.waiting.get(approvalId) ?? new Set<() => void>();
      this.waiting.set(approvalId, wakers);
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        wakers.delete(done);
        if (wakers.size === 0 && this.waiting.get(approvalId) === wakers) {
          this.waiting.delete(approvalId);
        }
        resolve();
      };
      const timer = setTimeout(done, ms);
      wakers.add(done);
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    });
  }
}

export type WaitResult = Approval | 'aborted' | 'timeout';

export interface WaitOptions {
  db: Queryable;
  waiters: ApprovalWaiters;
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  settleDue?: (() => Promise<Approval | null>) | undefined;
}

export async function waitForApproval(id: string, options: WaitOptions): Promise<WaitResult> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const due = options.settleDue ? await options.settleDue() : null;
    if (due) return due;
    const current = await getApproval(options.db, id);
    if (current && current.status !== 'pending') return current;
    if (options.signal.aborted) return 'aborted';
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'timeout';
    await options.waiters.wait(id, Math.min(options.pollMs, remaining), options.signal);
  }
}
