import { describe, expect, it, vi } from 'vitest';
import { sessionHostPaths } from './paths.ts';
import { clientFrameSchema, encodeFrame, frameReader, HOST_FRAME_LIMIT } from './protocol.ts';

describe('session host frames', () => {
  it('reads frames split across chunks and multi-byte characters', () => {
    const frames: unknown[] = [];
    const bad = vi.fn();
    const read = frameReader((raw) => {
      frames.push(raw);
      return true;
    }, bad);
    const encoded = Buffer.from(
      encodeFrame({ kind: 'output', session: 's1', data: 'naïve ✓' }) +
        encodeFrame({ kind: 'reply', id: 2, result: null }),
    );
    for (let offset = 0; offset < encoded.length; offset += 3)
      read(encoded.subarray(offset, offset + 3));
    expect(frames).toEqual([
      { kind: 'output', session: 's1', data: 'naïve ✓' },
      { kind: 'reply', id: 2, result: null },
    ]);
    expect(bad).not.toHaveBeenCalled();
  });

  it('stops at a line that is not JSON, at a refused frame and past the size limit', () => {
    const seen = vi.fn(() => true);
    const bad = vi.fn();
    const read = frameReader(seen, bad);
    read(Buffer.from('{"a":1}\nnot json\n{"b":2}\n'));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);

    const refusing = vi.fn(() => false);
    const refused = vi.fn();
    frameReader(refusing, refused)(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(refusing).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledTimes(1);

    const tooLong = vi.fn();
    frameReader(() => true, tooLong)(Buffer.alloc(HOST_FRAME_LIMIT + 1, 'x'));
    expect(tooLong).toHaveBeenCalledTimes(1);
  });

  it('accepts only known requests with a valid session id', () => {
    const create = {
      kind: 'create',
      session: 'a-1',
      cols: 80,
      rows: 24,
      cwd: '/w',
      command: 'claude',
      args: [],
      env: {},
    };
    expect(clientFrameSchema.safeParse({ id: 1, request: create }).success).toBe(true);
    expect(
      clientFrameSchema.safeParse({ id: 1, request: { ...create, session: '../x' } }).success,
    ).toBe(false);
    expect(clientFrameSchema.safeParse({ id: 1, request: { kind: 'exec' } }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ kind: 'hello', nonce: 'short' }).success).toBe(false);
  });
});

describe('session host paths', () => {
  it('uses a named pipe keyed by the folder on Windows, ignoring letter case', () => {
    const upper = sessionHostPaths('C:\\Users\\Me\\Spark\\host', 'win32');
    const lower = sessionHostPaths('c:\\users\\me\\spark\\host', 'win32');
    expect(upper.socket).toMatch(/^\\\\\.\\pipe\\spark-outpost-sessions-[0-9a-f]{24}$/);
    expect(lower.socket).toBe(upper.socket);
    expect(upper.token).toBe('C:\\Users\\Me\\Spark\\host\\token');
  });

  it('uses a socket in the folder elsewhere and refuses one that is too long', () => {
    expect(sessionHostPaths('/data/host', 'darwin')).toEqual({
      directory: '/data/host',
      socket: '/data/host/s',
      token: '/data/host/token',
    });
    expect(() => sessionHostPaths(`/${'x'.repeat(120)}`, 'darwin')).toThrow('too long');
  });
});
