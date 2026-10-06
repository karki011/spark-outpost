export const DEFAULT_FOCUS_CLIENT = 'local:window';
const CLIENT_LIMIT = 64;

export class ClientFocus {
  private readonly focusedAt = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  set(clientId: string, focused: boolean): void {
    this.dropStale();
    this.focusedAt.delete(clientId);
    if (!focused) return;
    if (this.focusedAt.size >= CLIENT_LIMIT) {
      this.focusedAt.delete(this.focusedAt.keys().next().value!);
    }
    this.focusedAt.set(clientId, this.now());
  }

  focusedClients(): string[] {
    this.dropStale();
    return [...this.focusedAt.keys()];
  }

  anyFocused(): boolean {
    return this.focusedClients().length > 0;
  }

  private dropStale(): void {
    const oldest = this.now() - this.ttlMs;
    for (const [clientId, at] of this.focusedAt) {
      if (at <= oldest) this.focusedAt.delete(clientId);
    }
  }
}
