import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { updateBlobView } from './update-blob-state.ts';

const base: UpdateStatus = {
  currentVersion: '0.2.0',
  channel: 'stable',
  autoDownload: true,
  phase: 'idle',
  offReason: null,
  availableVersion: '0.3.0',
  progress: null,
  installRequested: false,
  waitingForRuns: false,
  lastCheckedAt: null,
  error: null,
  skippedVersion: null,
  releaseNotesUrl: null,
};

describe('updateBlobView', () => {
  it('stays hidden with nothing to offer, while off, or during a background download', () => {
    expect(updateBlobView(null)).toBeNull();
    expect(updateBlobView({ ...base, availableVersion: null })).toBeNull();
    expect(updateBlobView({ ...base, phase: 'off' })).toBeNull();
    expect(updateBlobView({ ...base, phase: 'downloading', progress: 30 })).toBeNull();
  });

  it('offers the update once it is available or ready', () => {
    for (const phase of ['available', 'ready'] as const) {
      expect(updateBlobView({ ...base, phase })).toMatchObject({
        step: 'ready',
        label: 'Update',
        description: 'New update ready — click to get the latest (Spark Outpost 0.3.0)',
      });
    }
  });

  it('shows progress after a click, then waiting or restarting', () => {
    expect(
      updateBlobView({ ...base, phase: 'downloading', installRequested: true, progress: 42 }),
    ).toMatchObject({ step: 'downloading', label: '42%', progress: 42, mood: 'working' });
    expect(
      updateBlobView({ ...base, phase: 'ready', installRequested: true, waitingForRuns: true }),
    ).toMatchObject({ step: 'waiting', label: 'Waiting', mood: 'sleep' });
    expect(updateBlobView({ ...base, phase: 'installing' })).toMatchObject({
      step: 'installing',
      label: 'Restarting',
    });
  });
});
