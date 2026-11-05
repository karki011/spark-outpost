import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  apiPortFile,
  chooseApiPort,
  isStablePort,
  randomStablePort,
  readApiPort,
  saveApiPort,
  STABLE_PORTS,
} from './api-port.ts';
import { LOOPBACK, portIsFree } from './ports.ts';

const folders: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

function occupy(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

describe('chooseApiPort', () => {
  const never = async () => {
    throw new Error('no fallback expected');
  };

  it('reuses the saved port while it is free', async () => {
    const port = await chooseApiPort({
      saved: 31_234,
      isFree: async () => true,
      random: () => 35_000,
      fallback: never,
    });
    expect(port).toBe(31_234);
  });

  it('moves to another stable port when the saved one is taken', async () => {
    const offered = [31_234, 32_000];
    const port = await chooseApiPort({
      saved: 31_234,
      isFree: async (candidate) => candidate !== 31_234,
      random: () => offered.shift() ?? 33_000,
      fallback: never,
    });
    expect(port).toBe(32_000);
  });

  it('picks a stable port on the first launch', async () => {
    const port = await chooseApiPort({
      saved: null,
      isFree: async () => true,
      random: () => 36_500,
      fallback: never,
    });
    expect(port).toBe(36_500);
  });

  it('falls back to any free port when the stable range is full', async () => {
    const port = await chooseApiPort({
      saved: null,
      isFree: async () => false,
      random: () => 36_500,
      fallback: async () => 61_000,
    });
    expect(port).toBe(61_000);
  });
});

describe('stable port range', () => {
  it('stays below the system range for temporary ports', () => {
    for (let index = 0; index < 200; index += 1)
      expect(isStablePort(randomStablePort())).toBe(true);
    expect(STABLE_PORTS.last).toBeLessThan(49_152);
  });
});

describe('saved API port', () => {
  it('round-trips and ignores damaged or out-of-range values', async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'spark-port-'));
    folders.push(folder);
    const file = apiPortFile(folder);
    expect(await readApiPort(file)).toBeNull();
    await saveApiPort(file, 34_567);
    expect(await readApiPort(file)).toBe(34_567);
    writeFileSync(file, '{"port": 61000}');
    expect(await readApiPort(file)).toBeNull();
    writeFileSync(file, 'nope');
    expect(await readApiPort(file)).toBeNull();
  });
});

describe('portIsFree', () => {
  it('tells a taken port from a free one', async () => {
    const taken = await occupy();
    expect(await portIsFree(taken)).toBe(false);
    servers.splice(0).forEach((server) => server.close());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await portIsFree(taken)).toBe(true);
  });
});
