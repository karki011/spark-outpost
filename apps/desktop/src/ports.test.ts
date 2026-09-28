import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { freePort, LOOPBACK } from './ports.ts';

function bind(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => server.close(() => resolve()));
  });
}

describe('freePort', () => {
  it('returns a loopback port that can be bound right away', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1023);
    await expect(bind(port)).resolves.toBeUndefined();
  });

  it('picks a different port on each launch', async () => {
    const ports = await Promise.all([freePort(), freePort(), freePort()]);
    expect(new Set(ports).size).toBe(3);
  });
});
