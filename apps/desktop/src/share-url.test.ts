import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bakedShareEnv } from './share-url.ts';
import { bakedServerEnv } from './baked-env.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-share-url-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const manifest = (fields: object) =>
  writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'spark-outpost', ...fields }));

describe('bakedShareEnv', () => {
  it('hands the server the share origin baked into the packaged app', async () => {
    await manifest({ shareUrl: 'https://share.example' });
    expect(await bakedShareEnv(dir)).toEqual({ SPARK_SHARE_URL: 'https://share.example' });
    expect(await bakedServerEnv(dir)).toMatchObject({ SPARK_SHARE_URL: 'https://share.example' });
  });

  it('gives nothing when no origin, a bad one or no manifest was baked', async () => {
    expect(await bakedShareEnv(dir)).toEqual({});
    await manifest({});
    expect(await bakedShareEnv(dir)).toEqual({});
    await manifest({ shareUrl: 'http://share.example' });
    expect(await bakedShareEnv(dir)).toEqual({});
    await manifest({ shareUrl: 'https://share.example/v1' });
    expect(await bakedShareEnv(dir)).toEqual({});
  });
});
