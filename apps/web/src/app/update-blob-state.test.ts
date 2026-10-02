import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '@spark-outpost/contracts';
import { downloadPercent, shownFill, updateBlobView } from './update-blob-state.ts';

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
  devBuild: false,
  preview: false,
  previewUpdatedTo: null,
};

describe('updateBlobView', () => {
  it('stays hidden with nothing to offer, while off, or during a background download', () => {
    expect(updateBlobView(null)).toBeNull();
    expect(updateBlobView({ ...base, availableVersion: null })).toBeNull();
    expect(updateBlobView({ ...base, phase: 'off' })).toBeNull();
    expect(updateBlobView({ ...base, phase: 'downloading', progress: 30 })).toBeNull();
  });

  it('offers an available update as an empty gray blob', () => {
    expect(updateBlobView({ ...base, phase: 'available' })).toMatchObject({
      step: 'available',
      label: 'Update',
      description: 'Update ready to download · click to get it (Spark Outpost 0.3.0)',
      fill: 0,
    });
  });

  it('fills with the download progress and looks excited', () => {
    expect(
      updateBlobView({ ...base, phase: 'downloading', installRequested: true, progress: 42 }),
    ).toMatchObject({
      step: 'downloading',
      label: '42%',
      description: 'Getting Spark Outpost 0.3.0: 42%',
      fill: 42,
      mood: 'alert',
    });
  });

  it('is fully coloured and happy when ready, then waits or installs', () => {
    expect(updateBlobView({ ...base, phase: 'ready' })).toMatchObject({
      step: 'ready',
      label: 'Restart',
      description: 'Restart to update (Spark Outpost 0.3.0)',
      fill: null,
      mood: 'happy',
    });
    expect(
      updateBlobView({ ...base, phase: 'ready', installRequested: true, waitingForRuns: true }),
    ).toMatchObject({ step: 'waiting', label: 'Waiting', mood: 'sleep' });
    expect(updateBlobView({ ...base, phase: 'installing' })).toMatchObject({
      step: 'installing',
      label: 'Installing…',
    });
  });

  it('celebrates a preview update only while asked to', () => {
    const relaunched = { ...base, availableVersion: null, previewUpdatedTo: '0.3.0' };
    expect(updateBlobView(relaunched)).toBeNull();
    expect(updateBlobView(relaunched, true)).toMatchObject({
      step: 'updated',
      description: 'Updated to 0.3.0 (preview)',
      mood: 'happy',
    });
    expect(updateBlobView({ ...base, availableVersion: null }, true)).toBeNull();
  });
});

describe('download percent and fill', () => {
  it('reports a percentage only for a download the user asked for', () => {
    expect(downloadPercent(null)).toBeNull();
    expect(downloadPercent({ ...base, phase: 'downloading', progress: 30 })).toBeNull();
    expect(
      downloadPercent({ ...base, phase: 'downloading', progress: 30, installRequested: true }),
    ).toBe(30);
  });

  it('steps the fill in quarters with reduced motion', () => {
    expect(shownFill(null, true)).toBeNull();
    expect(shownFill(64, false)).toBe(64);
    expect(shownFill(64, true)).toBe(50);
    expect(shownFill(24, true)).toBe(0);
    expect(shownFill(100, true)).toBe(100);
  });
});
