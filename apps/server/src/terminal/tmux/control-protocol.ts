export type ControlEvent =
  | { type: 'output'; paneId: string; data: Buffer }
  | { type: 'reply'; ok: boolean; lines: string[] }
  | { type: 'notice'; name: string }
  | { type: 'exit' };

const NEWLINE = 0x0a;
const BACKSLASH = 0x5c;
const ZERO = 0x30;
const PERCENT = 0x25;
const OUTPUT_PREFIX = Buffer.from('%output ', 'latin1');

function isOutput(raw: Buffer): boolean {
  return (
    raw.length >= OUTPUT_PREFIX.length &&
    raw[0] === PERCENT &&
    raw.compare(OUTPUT_PREFIX, 0, OUTPUT_PREFIX.length, 0, OUTPUT_PREFIX.length) === 0
  );
}

export function decodeOutput(escaped: Buffer): Buffer {
  const decoded = Buffer.allocUnsafe(escaped.length);
  let length = 0;
  for (let index = 0; index < escaped.length; index++) {
    const byte = escaped[index]!;
    if (byte === BACKSLASH && isOctal(escaped, index + 1)) {
      decoded[length++] =
        (((escaped[index + 1]! - ZERO) << 6) |
          ((escaped[index + 2]! - ZERO) << 3) |
          (escaped[index + 3]! - ZERO)) &
        0xff;
      index += 3;
    } else decoded[length++] = byte;
  }
  return decoded.subarray(0, length);
}

function isOctal(buffer: Buffer, from: number): boolean {
  if (from + 3 > buffer.length) return false;
  for (let index = from; index < from + 3; index++) {
    const byte = buffer[index]!;
    if (byte < 0x30 || byte > 0x37) return false;
  }
  return true;
}

export function createControlParser(onEvent: (event: ControlEvent) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let reply: string[] | null = null;

  const output = (raw: Buffer) => {
    const space = raw.indexOf(0x20, OUTPUT_PREFIX.length);
    if (space < 0) return;
    onEvent({
      type: 'output',
      paneId: raw.toString('latin1', OUTPUT_PREFIX.length, space),
      data: decodeOutput(raw.subarray(space + 1)),
    });
  };

  const line = (raw: Buffer) => {
    if (!reply && isOutput(raw)) return output(raw);
    const text = raw.toString('utf8');
    if (reply) {
      if (text.startsWith('%end ') || text.startsWith('%error ')) {
        onEvent({ type: 'reply', ok: text.startsWith('%end '), lines: reply });
        reply = null;
      } else reply.push(text);
      return;
    }
    if (text.startsWith('%begin ')) {
      reply = [];
      return;
    }
    if (text === '%exit' || text.startsWith('%exit ')) onEvent({ type: 'exit' });
    else if (text.startsWith('%'))
      onEvent({ type: 'notice', name: text.slice(1).split(' ', 1)[0]! });
  };

  return (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const end = pending.indexOf(NEWLINE, start);
      if (end < 0) break;
      line(pending.subarray(start, end));
      start = end + 1;
    }
    pending = pending.subarray(start);
  };
}
