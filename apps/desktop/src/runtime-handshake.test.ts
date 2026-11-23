import { describe, expect, it } from 'vitest';
import { createSecret, runtimePaths, runtimeProof, sameProof } from './runtime-handshake.ts';

describe('runtime handshake', () => {
  it('binds a proof to the token, the role and both nonces', () => {
    const proof = runtimeProof('token', 'host', 'client-nonce', 'host-nonce');
    expect(sameProof(proof, runtimeProof('token', 'host', 'client-nonce', 'host-nonce'))).toBe(
      true,
    );
    expect(sameProof(proof, runtimeProof('token', 'client', 'client-nonce', 'host-nonce'))).toBe(
      false,
    );
    expect(sameProof(proof, runtimeProof('other', 'host', 'client-nonce', 'host-nonce'))).toBe(
      false,
    );
    expect(sameProof(proof, runtimeProof('token', 'host', 'client-nonce', 'replayed'))).toBe(false);
    expect(sameProof(proof, runtimeProof('token', 'host', 'client-noncehost', '-nonce'))).toBe(
      false,
    );
    expect(sameProof(proof, 'short')).toBe(false);
    expect(proof).not.toContain('token');
  });

  it('creates a fresh secret each time', () => {
    expect(createSecret()).toHaveLength(43);
    expect(createSecret()).not.toBe(createSecret());
  });

  it('keeps the socket, token and endpoint inside the runtime directory', () => {
    expect(runtimePaths('/data/runtime', 'darwin')).toEqual({
      socket: '/data/runtime/control.sock',
      token: '/data/runtime/token',
      endpoint: '/data/runtime/endpoint.json',
    });
  });

  it('refuses a directory whose socket path the system cannot bind', () => {
    expect(() => runtimePaths(`/${'d'.repeat(100)}/runtime`, 'darwin')).toThrow(/too long/);
  });

  it('uses a named pipe for this data folder on Windows, with the files beside it', () => {
    const paths = runtimePaths('C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\runtime', 'win32');
    expect(paths.socket).toMatch(/^\\\\\.\\pipe\\spark-outpost-runtime-[0-9a-f]{24}$/);
    expect(paths.token).toBe('C:\\Users\\me\\AppData\\Roaming\\Spark Outpost\\runtime\\token');
    const other = runtimePaths(
      'C:\\Users\\me\\AppData\\Roaming\\Spark Outpost Dev\\runtime',
      'win32',
    );
    expect(other.socket).not.toBe(paths.socket);
    const sameFolder = runtimePaths(
      'c:\\users\\me\\appdata\\roaming\\spark outpost\\runtime',
      'win32',
    );
    expect(sameFolder.socket).toBe(paths.socket);
  });
});
