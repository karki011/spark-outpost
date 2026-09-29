import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectSecretValues } from './secret-values.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-secret-values-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('projectSecretValues', () => {
  it('collects sensitive and opaque values from the secret files at the project root', async () => {
    await writeFile(
      join(root, '.env'),
      [
        'MATHLIB_API_TOKEN=plainword',
        'NODE_ENV=development',
        'PORT=3000',
        'SESSION_ID=a1b2c3d4e5f6g7h8i9',
        'export DB_PASSWORD="two words"',
      ].join('\n'),
    );
    await writeFile(join(root, '.env.local'), 'STRIPE_KEY=rk_live_short');
    await writeFile(join(root, '.env.example'), 'EXAMPLE_TOKEN=not-a-real-one');
    await writeFile(join(root, 'config.env'), 'OTHER_TOKEN=not-secret-file');
    expect(await projectSecretValues([root])).toEqual([
      'a1b2c3d4e5f6g7h8i9',
      'rk_live_short',
      'plainword',
    ]);
  });

  it('returns nothing for a folder without secret files or one that is missing', async () => {
    await writeFile(join(root, 'readme.md'), 'API_TOKEN=abcdefghijk');
    expect(await projectSecretValues([root, join(root, 'missing')])).toEqual([]);
  });
});
