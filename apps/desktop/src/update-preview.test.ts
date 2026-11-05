import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { createUpdateController } from './update-controller.ts';
import {
  DOWNLOAD_STEPS,
  FLOW_CHECK_DELAY_MS,
  INSTALL_PAUSE_MS,
  nextPreviewVersion,
  previewActiveRuns,
  previewAutoDownload,
  previewDriver,
  previewMarkerFile,
  previewMode,
  takePreviewMarker,
  writePreviewMarker,
  type PreviewMode,
} from './update-preview.ts';
import { initialStatus, RUNS_RECHECK_MS } from './update-state.ts';

function flow(mode: PreviewMode, realRuns = 0) {
  const seen: UpdateStatus[] = [];
  const relaunches: number[] = [];
  let quits = 0;
  const controller = createUpdateController(
    (emit) =>
      previewDriver({
        mode,
        version: '0.1.0-beta.2',
        emit,
        relaunch: async () => {
          relaunches.push(Date.now());
        },
        quit: () => {
          quits += 1;
        },
      }),
    {
      initial: initialStatus({
        currentVersion: '0.1.0-beta.1',
        channel: 'beta',
        autoDownload: previewAutoDownload(mode),
        offReason: null,
        feedUrl: null,
        devBuild: true,
        preview: true,
      }),
      prefs: { channel: 'beta', autoDownload: previewAutoDownload(mode) },
      savePrefs: async () => undefined,
      skippedVersion: null,
      activeRuns: previewActiveRuns(mode, async () => realRuns),
      onChange: (status) => seen.push(status),
      quit: () => {
        quits += 1;
      },
      log: () => undefined,
    },
  );
  return { controller, seen, relaunches, quits: () => quits };
}

describe('update preview modes and versions', () => {
  it('accepts only the preview modes it can show', () => {
    expect(previewMode('available')).toBe('available');
    expect(previewMode('ready')).toBe('ready');
    expect(previewMode('flow')).toBe('flow');
    expect(previewMode('flow-busy')).toBe('flow-busy');
    expect(previewMode('installing')).toBeNull();
    expect(previewMode(undefined)).toBeNull();
  });

  it('offers the next version after the running one', () => {
    expect(nextPreviewVersion('0.1.0-beta.1')).toBe('0.1.0-beta.2');
    expect(nextPreviewVersion('0.3.9')).toBe('0.3.10');
    expect(nextPreviewVersion('0.0.0-dev')).toBe('9.9.9-preview');
  });

  it('downloads unevenly over about eight seconds and ends at 100%', () => {
    const total = DOWNLOAD_STEPS.reduce((sum, [waitMs]) => sum + waitMs, 0);
    expect(total).toBeGreaterThanOrEqual(7_000);
    expect(total).toBeLessThanOrEqual(9_000);
    const percents = DOWNLOAD_STEPS.map(([, percent]) => percent);
    expect(percents.at(-1)).toBe(100);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    const gaps = new Set(percents.map((percent, index) => percent - (percents[index - 1] ?? 0)));
    expect(gaps.size).toBeGreaterThan(4);
    expect(new Set(DOWNLOAD_STEPS.map(([waitMs]) => waitMs)).size).toBeGreaterThan(4);
  });
});

describe('update preview flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds an update after 3 s, waits for a click, fills, then relaunches', async () => {
    const run = flow('flow');
    const checked = run.controller.check();
    expect(run.controller.status().phase).toBe('checking');
    await vi.advanceTimersByTimeAsync(FLOW_CHECK_DELAY_MS - 1);
    expect(run.controller.status().phase).toBe('checking');
    await vi.advanceTimersByTimeAsync(1);
    await checked;
    expect(run.controller.status()).toMatchObject({
      phase: 'available',
      availableVersion: '0.1.0-beta.2',
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.controller.status().phase).toBe('available');

    expect(await run.controller.requestInstall()).toEqual({ status: 'downloading' });
    expect(run.controller.status()).toMatchObject({ phase: 'downloading', progress: 0 });
    await vi.advanceTimersByTimeAsync(400);
    expect(run.controller.status().progress).toBe(3);
    await vi.advanceTimersByTimeAsync(3_000);
    const midway = run.controller.status().progress ?? 0;
    expect(midway).toBeGreaterThan(30);
    expect(midway).toBeLessThan(60);

    const downloadMs = DOWNLOAD_STEPS.reduce((sum, [waitMs]) => sum + waitMs, 0);
    await vi.advanceTimersByTimeAsync(downloadMs - 3_400);
    expect(run.controller.status().phase).toBe('installing');
    const progress = run.seen.map((status) => status.progress).filter((value) => value !== null);
    expect(progress).toEqual(expect.arrayContaining([0, 3, 9, 47, 79, 100]));
    expect(run.seen.some((status) => status.phase === 'ready')).toBe(true);

    expect(run.relaunches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(INSTALL_PAUSE_MS);
    expect(run.relaunches).toHaveLength(1);
    expect(run.quits()).toBe(0);
  });

  it('waits for running work before it restarts in the busy variant', async () => {
    const run = flow('flow-busy');
    void run.controller.check();
    await vi.advanceTimersByTimeAsync(FLOW_CHECK_DELAY_MS);
    await run.controller.requestInstall();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(run.controller.status()).toMatchObject({ phase: 'ready', waitingForRuns: true });
    expect(run.relaunches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(RUNS_RECHECK_MS);
    expect(run.controller.status()).toMatchObject({ phase: 'installing', waitingForRuns: false });
    await vi.advanceTimersByTimeAsync(INSTALL_PAUSE_MS);
    expect(run.relaunches).toHaveLength(1);
  });

  it('uses real running work in the plain flow', async () => {
    const run = flow('flow', 2);
    void run.controller.check();
    await vi.advanceTimersByTimeAsync(FLOW_CHECK_DELAY_MS);
    await run.controller.requestInstall();
    await vi.advanceTimersByTimeAsync(9_000 + RUNS_RECHECK_MS * 2);
    expect(run.controller.status()).toMatchObject({ phase: 'ready', waitingForRuns: true });
    expect(run.relaunches).toHaveLength(0);
  });

  it('the ready mode downloads by itself and quitting just quits', async () => {
    const run = flow('ready');
    void run.controller.check();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(run.controller.status().phase).toBe('ready');
    expect(run.controller.takeOverQuit()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.quits()).toBe(1);
    expect(run.relaunches).toHaveLength(0);
  });
});

describe('update preview marker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'spark-preview-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is read once and then removed', async () => {
    const file = previewMarkerFile(dir);
    expect(await takePreviewMarker(file)).toBeNull();
    await writePreviewMarker(file, '0.1.0-beta.2');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: '0.1.0-beta.2' });
    expect(await takePreviewMarker(file)).toBe('0.1.0-beta.2');
    expect(existsSync(file)).toBe(false);
    expect(await takePreviewMarker(file)).toBeNull();
  });

  it('ignores and removes a malformed marker', async () => {
    const file = previewMarkerFile(dir);
    await writeFile(file, '{"version": 3}');
    expect(await takePreviewMarker(file)).toBeNull();
    expect(existsSync(file)).toBe(false);
  });
});
