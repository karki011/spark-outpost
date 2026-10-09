import type { AppEvent, AppEventKind } from '@spark-outpost/contracts';

const TASK_KINDS: ReadonlySet<AppEventKind> = new Set([
  'outpost_changed',
  'run',
  'approval',
  'conversation',
]);

export function movesTasks(event: AppEvent): boolean {
  return TASK_KINDS.has(event.kind);
}

export class TaskWakes {
  private readonly waiting = new Set<() => void>();

  get waiters(): number {
    return this.waiting.size;
  }

  changed(event: AppEvent): void {
    if (!movesTasks(event)) return;
    const woken = [...this.waiting];
    this.waiting.clear();
    woken.forEach((wake) => wake());
  }

  next(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        signal.removeEventListener('abort', wake);
        this.waiting.delete(wake);
        resolve();
      };
      signal.addEventListener('abort', wake, { once: true });
      this.waiting.add(wake);
    });
  }
}
