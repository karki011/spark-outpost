export class ParkedTurns {
  private readonly waits = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly quitters = new Map<symbol, () => void>();

  get size(): number {
    return this.waits.size;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  park(runId: string, onQuit?: () => void): () => void {
    this.waits.set(runId, (this.waits.get(runId) ?? 0) + 1);
    const key = Symbol(runId);
    if (onQuit) this.quitters.set(key, onQuit);
    this.changed();
    let parked = true;
    return () => {
      if (!parked) return;
      parked = false;
      this.quitters.delete(key);
      const left = (this.waits.get(runId) ?? 1) - 1;
      if (left > 0) this.waits.set(runId, left);
      else this.waits.delete(runId);
      this.changed();
    };
  }

  quit(): number {
    const stopping = [...this.quitters.values()];
    this.quitters.clear();
    for (const stop of stopping) stop();
    return stopping.length;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
