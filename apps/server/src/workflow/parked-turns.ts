export class ParkedTurns {
  private readonly waits = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  get size(): number {
    return this.waits.size;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  park(runId: string): () => void {
    this.waits.set(runId, (this.waits.get(runId) ?? 0) + 1);
    this.changed();
    let parked = true;
    return () => {
      if (!parked) return;
      parked = false;
      const left = (this.waits.get(runId) ?? 1) - 1;
      if (left > 0) this.waits.set(runId, left);
      else this.waits.delete(runId);
      this.changed();
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
