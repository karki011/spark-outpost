import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import {
  initialStatus,
  installDecision,
  parseChannel,
  reduceUpdate,
  updaterChannel,
  updateErrorMessage,
  type UpdateEvent,
} from './update-state.ts';

const AT = new Date('2026-10-01T12:00:00.000Z');

function status(offReason: 'dev' | null = null): UpdateStatus {
  return initialStatus({
    currentVersion: '0.1.0',
    channel: 'stable',
    autoDownload: true,
    offReason,
    feedUrl: offReason ? null : 'https://updates.example.com/spark',
  });
}

function run(events: UpdateEvent[], start = status()): UpdateStatus {
  return events.reduce(reduceUpdate, start);
}

const READY: UpdateEvent[] = [
  { type: 'available', version: '0.2.0' },
  { type: 'download-started', version: '0.2.0' },
  { type: 'downloaded', version: '0.2.0' },
];

describe('update status', () => {
  it('moves from checking through available and download to ready', () => {
    expect(
      run([
        { type: 'checking', at: AT },
        { type: 'available', version: '0.2.0' },
        { type: 'download-started', version: '0.2.0' },
        { type: 'progress', percent: 41.6 },
      ]),
    ).toMatchObject({ phase: 'downloading', progress: 42, lastCheckedAt: AT.toISOString() });
    expect(run(READY)).toMatchObject({
      phase: 'ready',
      availableVersion: '0.2.0',
      progress: 100,
      releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html',
    });
  });

  it('keeps a found or staged update through later checks', () => {
    const later: UpdateEvent[] = [{ type: 'checking', at: AT }, { type: 'not-available' }];
    expect(run(later, run([{ type: 'available', version: '0.2.0' }]))).toMatchObject({
      phase: 'available',
      availableVersion: '0.2.0',
    });
    expect(run(later, run(READY))).toMatchObject({ phase: 'ready' });
  });

  it('waits for running work, then installs', () => {
    const waiting = run([...READY, { type: 'waiting' }]);
    expect(waiting).toMatchObject({ phase: 'ready', installRequested: true, waitingForRuns: true });
    expect(reduceUpdate(waiting, { type: 'installing' })).toMatchObject({
      phase: 'installing',
      waitingForRuns: false,
    });
  });

  it('goes back to ready when the install step fails', () => {
    expect(
      run([...READY, { type: 'installing' }, { type: 'error', message: 'signature' }]),
    ).toMatchObject({ phase: 'ready', installRequested: false, error: 'signature' });
  });

  it('shows a skipped version instead of downloading it', () => {
    expect(run([{ type: 'skipped', version: '0.2.0' }])).toMatchObject({
      phase: 'idle',
      skippedVersion: '0.2.0',
    });
  });

  it('never leaves the off state for a dev copy, but keeps its settings', () => {
    const events: UpdateEvent[] = [
      { type: 'checking', at: AT },
      { type: 'available', version: '9.9.9' },
      { type: 'channel', channel: 'beta' },
      { type: 'auto-download', on: false },
    ];
    expect(run(events, status('dev'))).toMatchObject({
      phase: 'off',
      offReason: 'dev',
      channel: 'beta',
      autoDownload: false,
      releaseNotesUrl: null,
    });
  });

  it('drops a found update when the channel changes', () => {
    expect(
      run([
        { type: 'available', version: '0.2.0-beta.1' },
        { type: 'install-requested' },
        { type: 'channel', channel: 'stable' },
      ]),
    ).toMatchObject({ phase: 'idle', availableVersion: null, installRequested: false });
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
  const ready = run(READY);
  const waiting = { status: 'waiting', reason: 'Spark will update when your work finishes.' };

  it('installs only a ready update with no active runs', () => {
    expect(installDecision(ready, 0)).toEqual({ status: 'installing' });
  });

  it('waits while runs are active or cannot be checked', () => {
    expect(installDecision(ready, 2)).toEqual(waiting);
    expect(installDecision(ready, null)).toEqual(waiting);
  });

  it('has nothing to install before the download finishes', () => {
    expect(installDecision(run([{ type: 'available', version: '0.2.0' }]), 0)).toEqual({
      status: 'unavailable',
      reason: 'No update is ready yet.',
    });
  });
});

describe('updateErrorMessage', () => {
  it('explains a channel with no release yet and keeps other errors as they are', () => {
    expect(
      updateErrorMessage(
        'Cannot find channel "latest-mac.yml" update info: HttpError: 404 Not Found',
      ),
    ).toBe("There's no Stable release on the update feed yet. Check again later.");
    expect(updateErrorMessage('net::ERR_INTERNET_DISCONNECTED')).toBe(
      "Couldn't reach the update server. Check your connection.",
    );
    expect(updateErrorMessage('Something odd happened')).toBe('Something odd happened');
  });

  it('never shows the raw server response', () => {
    const raw =
      '401 Unauthorized "method: GET url: https://feed.example/beta-mac.yml\\n\\n Data:\\n <!doctype html><html><title>Unauthorized</title></html>"';
    expect(updateErrorMessage(raw)).toBe(
      "The update server isn't accepting requests right now. Try again later.",
    );
    expect(updateErrorMessage('HttpError: 404 Not Found\n<html>x</html>')).toBe(
      "There's no release on the update feed yet. Check again later.",
    );
    expect(updateErrorMessage('HttpError: 503 Service Unavailable')).toBe(
      'The update server had a problem. Try again later.',
    );
    expect(updateErrorMessage(`${'x'.repeat(400)}\nmore`)).toHaveLength(160);
  });
});
