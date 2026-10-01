import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import {
  initialStatus,
  installDecision,
  parseChannel,
  reduceUpdate,
  updaterChannel,
  type UpdateEvent,
} from './update-state.ts';

const AT = new Date('2026-10-01T12:00:00.000Z');

function run(events: UpdateEvent[], start?: Partial<UpdateStatus>): UpdateStatus {
  const status = {
    ...initialStatus({
      currentVersion: '0.1.0',
      channel: 'stable',
      offReason: null,
      feedUrl: 'https://updates.example.com/spark',
    }),
    ...start,
  };
  return events.reduce(reduceUpdate, status);
}

describe('update status', () => {
  it('moves from checking through download to ready', () => {
    const status = run([
      { type: 'checking', at: AT },
      { type: 'available', version: '0.2.0' },
      { type: 'progress', percent: 41.6 },
      { type: 'downloaded', version: '0.2.0' },
    ]);
    expect(status).toMatchObject({
      phase: 'ready',
      availableVersion: '0.2.0',
      progress: 100,
      lastCheckedAt: AT.toISOString(),
      releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html',
    });
  });

  it('keeps a staged update ready through later checks and errors', () => {
    const ready = run([
      { type: 'available', version: '0.2.0' },
      { type: 'downloaded', version: '0.2.0' },
    ]);
    const later = [
      { type: 'checking', at: AT },
      { type: 'not-available' },
      { type: 'error', message: 'offline' },
    ] as UpdateEvent[];
    expect(later.reduce(reduceUpdate, ready)).toMatchObject({
      phase: 'ready',
      availableVersion: '0.2.0',
      error: 'offline',
    });
  });

  it('shows a skipped version instead of downloading it', () => {
    expect(run([{ type: 'skipped', version: '0.2.0' }])).toMatchObject({
      phase: 'idle',
      skippedVersion: '0.2.0',
      availableVersion: null,
    });
  });

  it('never leaves the off state for a dev copy or a build without a feed', () => {
    const off = initialStatus({
      currentVersion: '0.0.0',
      channel: 'stable',
      offReason: 'dev',
      feedUrl: null,
    });
    const events: UpdateEvent[] = [
      { type: 'checking', at: AT },
      { type: 'available', version: '9.9.9' },
      { type: 'channel', channel: 'beta' },
    ];
    expect(events.reduce(reduceUpdate, off)).toMatchObject({
      phase: 'off',
      offReason: 'dev',
      channel: 'beta',
      releaseNotesUrl: null,
    });
  });

  it('clears a pending download when the channel changes', () => {
    expect(
      run([
        { type: 'available', version: '0.2.0-beta.1' },
        { type: 'channel', channel: 'stable' },
      ]),
    ).toMatchObject({ phase: 'idle', availableVersion: null, channel: 'stable' });
  });
});

describe('channel selection', () => {
  it('maps Stable to the latest feed file and Beta to the beta one', () => {
    expect(updaterChannel('stable')).toBe('latest');
    expect(updaterChannel('beta')).toBe('beta');
  });

  it('accepts only known channels from the window', () => {
    expect(parseChannel('beta')).toBe('beta');
    expect(parseChannel('stable')).toBe('stable');
    expect(parseChannel('alpha')).toBeNull();
    expect(parseChannel(undefined)).toBeNull();
  });
});

describe('installDecision', () => {
  const ready = run([
    { type: 'available', version: '0.2.0' },
    { type: 'downloaded', version: '0.2.0' },
  ]);

  it('installs only a ready update with no active runs', () => {
    expect(installDecision(ready, 0)).toEqual({ started: true });
  });

  it('waits while runs are active', () => {
    expect(installDecision(ready, 1)).toEqual({
      started: false,
      reason: '1 run is still working. Restart once they finish or you stop them.',
    });
    expect(installDecision(ready, 3)).toMatchObject({
      started: false,
      reason: expect.stringMatching(/^3 runs are still working/),
    });
  });

  it('refuses when running work cannot be checked', () => {
    expect(installDecision(ready, null)).toMatchObject({ started: false });
  });

  it('has nothing to install before the download finishes', () => {
    const downloading = run([{ type: 'available', version: '0.2.0' }]);
    expect(installDecision(downloading, 0)).toEqual({
      started: false,
      reason: 'No update is ready yet.',
    });
  });
});
