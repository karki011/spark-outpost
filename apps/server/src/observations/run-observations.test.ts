import { describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { createRunObservations } from './run-observations.ts';

const failingDb = {
  query: () => Promise.reject(new Error('database down')),
} as unknown as Db;

describe('reading a turn’s observations', () => {
  it('reports an incomplete history when the saved reads cannot be read', async () => {
    const observations = createRunObservations({ db: failingDb, runId: 'run' });
    observations.record({ source: 'web_page', label: 'web page (example.com)' });
    expect(await observations.labels()).toEqual(['web page (example.com)']);
    expect(await observations.completeLabels()).toBeNull();
  });
});
