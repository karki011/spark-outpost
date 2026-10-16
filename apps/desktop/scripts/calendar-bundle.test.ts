import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CALENDAR_BINARY,
  CALENDAR_SEED_BINARY,
  calendarBuiltDir,
  calendarCheck,
  calendarPackage,
  calendarStamp,
  stageCalendar,
  stagedCalendarProblems,
} from './calendar-bundle.ts';

const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
const built = calendarBuiltDir(path.resolve(import.meta.dirname, '../../..'), arch);

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'calendar-'));
  made.push(dir);
  return dir;
}

async function put(dir: string, file: string, text = ''): Promise<void> {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), text);
}

describe('the Calendar helper build', () => {
  it('builds each architecture into its own folder', () => {
    expect(calendarPackage('/repo')).toBe('/repo/apps/desktop/calendar');
    expect(calendarBuiltDir('/repo', 'arm64')).toBe('/repo/.local/calendar/arm64');
    expect(calendarBuiltDir('/repo', 'x64')).toBe('/repo/.local/calendar/x64');
  });

  it('stamps the Swift sources and the manifest, ignoring build output', async () => {
    const dir = await tempDir();
    await put(dir, 'Package.swift', 'let package = 1');
    await put(dir, 'Sources/CalendarCore/Engine.swift', 'struct A {}');
    const first = await calendarStamp(dir);
    await put(dir, '.build/debug/Generated.swift', 'struct B {}');
    await put(dir, 'README.txt', 'notes');
    expect(await calendarStamp(dir)).toBe(first);
    await put(dir, 'Package.swift', 'let package = 2');
    expect(await calendarStamp(dir)).not.toBe(first);
  });

  it('names the build command when the helper is missing', async () => {
    const dir = await tempDir();
    await expect(calendarCheck(path.join(dir, CALENDAR_BINARY), 'arm64')).rejects.toThrow(
      `No spark-calendar for arm64 at ${dir}/spark-calendar. Run pnpm desktop:calendar to build it; Calendar needs it.`,
    );
  });
});

describe('the staged Calendar helper', () => {
  it('accepts only the helper', async () => {
    const dir = await tempDir();
    await put(dir, `bin/${CALENDAR_BINARY}`);
    expect(await stagedCalendarProblems(dir)).toEqual([]);
  });

  it('refuses the seed tool and a missing helper', async () => {
    const dir = await tempDir();
    await put(dir, `bin/${CALENDAR_SEED_BINARY}`);
    expect(await stagedCalendarProblems(dir)).toEqual([
      'bin/spark-calendar is missing',
      'spark-calendar-seed is a development tool and must not ship',
    ]);
  });

  it('reports a missing staged folder as a missing helper', async () => {
    const dir = await tempDir();
    expect(await stagedCalendarProblems(path.join(dir, 'nothing'))).toEqual([
      'bin/spark-calendar is missing',
    ]);
  });

  it.skipIf(!existsSync(path.join(built, CALENDAR_SEED_BINARY)))(
    'stages the built helper and leaves the seed tool behind',
    async () => {
      const resources = await tempDir();
      await stageCalendar(built, arch, resources);
      expect(await readdir(path.join(resources, 'calendar/bin'))).toEqual([CALENDAR_BINARY]);
      expect(await stagedCalendarProblems(path.join(resources, 'calendar'))).toEqual([]);
    },
  );
});
