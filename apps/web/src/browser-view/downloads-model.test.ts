import { describe, expect, it } from 'vitest';
import type { BrowserDownload } from '@spark-outpost/contracts';
import { downloadStatus } from './downloads-model.ts';

const base: BrowserDownload = {
  id: 'd1',
  filename: 'report.pdf',
  host: 'files.example.com',
  where: 'personal',
  by: 'you',
  state: 'saving',
  receivedBytes: 1024,
  totalBytes: 4096,
  at: '2026-10-23T12:00:00Z',
};

describe('download status lines', () => {
  it('say where a download stands in words', () => {
    expect(downloadStatus(base)).toEqual({
      tone: 'busy',
      text: 'Saving · 25% · files.example.com · Personal',
    });
    expect(downloadStatus({ ...base, state: 'saved', receivedBytes: 2_621_440 }).text).toBe(
      'Saved · 2.5 MB · files.example.com · Personal',
    );
    expect(downloadStatus({ ...base, state: 'failed', where: 'work' }).text).toBe(
      'Didn’t finish · files.example.com · Work',
    );
  });

  it('say who started a download that was not saved', () => {
    expect(downloadStatus({ ...base, state: 'blocked', by: 'agent', where: 'chat' })).toEqual({
      tone: 'refused',
      text: 'Not saved: an agent’s action started it · files.example.com · a chat',
    });
    expect(downloadStatus({ ...base, state: 'blocked', by: 'page' }).text).toBe(
      'Not saved: you didn’t start it · files.example.com · Personal',
    );
  });
});
