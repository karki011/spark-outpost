import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { saveSessionImage, writeSessionImage } from './native-images.ts';
import type { LiveSession } from './native-runtime-types.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'spark-images-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a picture for a Terminal session', () => {
  it('is written under the session folder, readable only by this user, with a new name each time', async () => {
    const first = await writeSessionImage(directory, { mediaType: 'image/png', data: PNG });
    const second = await writeSessionImage(directory, { mediaType: 'image/jpeg', data: PNG });
    expect(dirname(first)).toBe(join(directory, 'attachments'));
    expect(first).toMatch(/browser-[0-9a-f]{8}\.png$/);
    expect(second).toMatch(/\.jpg$/);
    expect(await readFile(first)).toEqual(PNG);
    expect((await stat(first)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(first))).mode & 0o777).toBe(0o700);
  });

  it('refuses anything but PNG and JPEG', async () => {
    await expect(
      writeSessionImage(directory, { mediaType: 'image/svg+xml', data: Buffer.from('<svg/>') }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('is refused when the session is not running', async () => {
    const db = { query: () => Promise.reject(new Error('not reached')) } as unknown as Queryable;
    await expect(saveSessionImage(db, 'w', undefined, 'a')).rejects.toMatchObject({
      status: 409,
      message: 'This terminal session is not running, so the picture was not saved.',
    });
    const withoutFolder = { launch: {} } as unknown as LiveSession;
    await expect(saveSessionImage(db, 'w', withoutFolder, 'a')).rejects.toMatchObject({
      status: 409,
    });
  });
});
