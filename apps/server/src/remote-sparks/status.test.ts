import { describe, expect, it } from 'vitest';
import { remoteSparkStatuses } from './status.ts';

const STUDIO = '0198c0de-0000-7000-8000-000000000001';
const GARAGE = '0198c0de-0000-7000-8000-000000000002';

describe('the status of a saved Spark', () => {
  it('is not paired without a sign-in, whatever was reported', () => {
    const statuses = remoteSparkStatuses();
    statuses.report(STUDIO, { status: 'online', needsYou: 4 });

    expect(statuses.of(STUDIO, false)).toEqual({ status: 'not-paired', needsYou: 0 });
  });

  it('is checking until the desktop app reports', () => {
    expect(remoteSparkStatuses().of(STUDIO, true)).toEqual({ status: 'checking', needsYou: 0 });
  });

  it('is the last report, with no count while offline', () => {
    const statuses = remoteSparkStatuses();
    statuses.report(STUDIO, { status: 'online', needsYou: 3 });
    statuses.report(GARAGE, { status: 'offline', needsYou: 7 });

    expect(statuses.of(STUDIO, true)).toEqual({ status: 'online', needsYou: 3 });
    expect(statuses.of(GARAGE, true)).toEqual({ status: 'offline', needsYou: 0 });

    statuses.report(STUDIO, { status: 'online', needsYou: 0 });
    expect(statuses.of(STUDIO, true)).toEqual({ status: 'online', needsYou: 0 });
  });

  it('goes back to checking when dropped or cleared', () => {
    const statuses = remoteSparkStatuses();
    statuses.report(STUDIO, { status: 'online', needsYou: 3 });
    statuses.report(GARAGE, { status: 'online', needsYou: 1 });

    statuses.drop(STUDIO);
    expect(statuses.of(STUDIO, true).status).toBe('checking');
    expect(statuses.of(GARAGE, true).status).toBe('online');

    statuses.clear();
    expect(statuses.of(GARAGE, true).status).toBe('checking');
  });
});
