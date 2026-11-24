const COMPACT_AFTER = 1024;

export interface ReplayBuffer {
  push(data: string): void;
  text(): string;
}

function ownCopy(text: string): string {
  return Buffer.from(text, 'utf16le').toString('utf16le');
}

export function createReplayBuffer(
  limit: number,
  filter: (text: string) => string = (text) => text,
): ReplayBuffer {
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
    push(raw) {
      const data = filter(raw);
      if (data === '') return;
      const kept = data.length > limit ? ownCopy(data.slice(-limit)) : data;
      chunks.push(kept);
      length += kept.length;
      trim();
    },
    text() {
      const whole = chunks.slice(head).join('');
      const joined = whole.length > limit ? ownCopy(whole.slice(-limit)) : whole;
      chunks = joined === '' ? [] : [joined];
      head = 0;
      length = joined.length;
      return joined;
    },
  };
}
