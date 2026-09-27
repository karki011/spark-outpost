export const JEV_CALLS_IN_FLIGHT = 4;

export class JevLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly limit: number) {}

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const admit = () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        const at = this.waiting.indexOf(admit);
        if (at !== -1) this.waiting.splice(at, 1);
        reject(signal.reason);
      };
      this.waiting.push(admit);
      signal.addEventListener('abort', cancel, { once: true });
    });
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}
