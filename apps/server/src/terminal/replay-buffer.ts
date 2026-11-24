const COMPACT_AFTER = 1024;

export interface ReplayBuffer {
  push(data: string): void;
  text(): string;
}

export function createReplayBuffer(limit: number): ReplayBuffer {
  let chunks: string[] = [];
  let head = 0;
  let length = 0;

  const trim = () => {
    while (head < chunks.length - 1 && length - chunks[head]!.length >= limit) {
      length -= chunks[head]!.length;
      chunks[head] = '';
      head += 1;
    }
    if (head >= COMPACT_AFTER) {
      chunks = chunks.slice(head);
      head = 0;
    }
  };

  return {
    push(data) {
      if (data === '') return;
      const kept = data.length > limit ? data.slice(-limit) : data;
      chunks.push(kept);
      length += kept.length;
      trim();
    },
    text() {
      const joined = chunks.slice(head).join('').slice(-limit);
      chunks = joined === '' ? [] : [joined];
      head = 0;
      length = joined.length;
      return joined;
    },
  };
}
