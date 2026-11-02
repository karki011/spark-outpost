const QUIET_MS = 25;
const LONGEST_WAIT_MS = 1_000;

export interface OutputQuiet {
  tracked<T>(source: AsyncIterable<T>): AsyncGenerator<T>;
  settled(): Promise<void>;
}

export function createOutputQuiet(quietMs = QUIET_MS, longestMs = LONGEST_WAIT_MS): OutputQuiet {
  let handling = false;
  let lastAt = 0;
  return {
    async *tracked<T>(source: AsyncIterable<T>) {
      for await (const output of source) {
        handling = true;
        yield output;
        handling = false;
        lastAt = Date.now();
      }
    },
    async settled() {
      const deadline = Date.now() + longestMs;
      do {
        await new Promise((resolve) => setTimeout(resolve, quietMs));
        if (!handling && Date.now() - lastAt >= quietMs) return;
      } while (Date.now() < deadline);
    },
  };
}
