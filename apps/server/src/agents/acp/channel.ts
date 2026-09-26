export class Channel<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting: (() => void) | null = null;
  private closed = false;
  private failure: unknown = null;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake();
  }

  close(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error ?? null;
    this.wake();
  }

  private wake() {
    const resume = this.waiting;
    this.waiting = null;
    resume?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.closed) {
        if (this.failure) throw this.failure;
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }
}
