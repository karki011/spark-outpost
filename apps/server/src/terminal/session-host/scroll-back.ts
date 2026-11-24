export const SCROLL_BACK_CHARS = 256_000;

export class ScrollBack {
  private chunks: string[] = [];
  private length = 0;

  constructor(private readonly limit: number = SCROLL_BACK_CHARS) {}

  push(text: string): void {
    if (!text) return;
    this.chunks.push(text);
    this.length += text.length;
    if (this.length > this.limit) this.trim();
  }

  text(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')];
    return this.chunks[0] ?? '';
  }

  get size(): number {
    return this.length;
  }

  private trim(): void {
    const whole = this.chunks.join('');
    const over = whole.length - this.limit;
    const line = whole.indexOf('\n', over);
    const cut = line === -1 || line - over > this.limit / 4 ? over : line + 1;
    const kept = whole.slice(cut);
    this.chunks = kept ? [kept] : [];
    this.length = kept.length;
  }
}
