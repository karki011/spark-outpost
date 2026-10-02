import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BootTeaserSnapshot } from '@spark-outpost/contracts';
import { teaserLines, teaserSnapshot, whatsNew } from './boot-teasers.ts';
import { digest, SECRET_PROJECT, SECRET_TITLE, teammates, today } from './teaser-fixtures.ts';

const changelog = readFileSync(path.join(import.meta.dirname, '../CHANGELOG.md'), 'utf8');
const version = '0.1.0-beta.1';
const NOW = new Date('2026-10-02T15:00:00.000Z');
const first = () => 0;

const quiet: BootTeaserSnapshot = {
  savedAt: '2026-10-02T12:00:00.000Z',
  running: 0,
  needsYou: 0,
  prs: 0,
  briefAt: null,
  busy: [],
  waiting: [],
};

function lines(snapshot: BootTeaserSnapshot | null, defaultShortcut = true) {
  return teaserLines({
    snapshot,
    changelog,
    version,
    defaultShortcut,
    now: NOW,
    timeZone: 'UTC',
    random: first,
  });
}

describe('teaser snapshot', () => {
  it('keeps only counts and Spark names', () => {
    const snapshot = teaserSnapshot(
      {
        activeRuns: 2,
        today: today(),
        digest: digest('2026-10-02T08:05:00.000Z'),
        teammates: teammates([
          ['Wren', 'needs_you'],
          ['Bolt', 'working'],
          ['Pip', 'idle'],
          ['  A very long Spark name that keeps going  ', 'working'],
        ]),
      },
      NOW,
    );
    expect(snapshot).toEqual({
      savedAt: NOW.toISOString(),
      running: 2,
      needsYou: 1,
      prs: 2,
      briefAt: '2026-10-02T08:05:00.000Z',
      busy: ['Bolt', 'A very long Spark name t'],
      waiting: ['Wren'],
    });
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain(SECRET_PROJECT);
  });

  it('caps the names and skips a brief that is not ready', () => {
    const many = teammates([
      ['A', 'working'],
      ['B', 'working'],
      ['C', 'working'],
      ['D', 'working'],
    ]);
    const snapshot = teaserSnapshot(
      { activeRuns: 0, today: today(), digest: digest(null), teammates: many },
      NOW,
    );
    expect(snapshot.busy).toEqual(['A', 'B', 'C']);
    expect(snapshot.briefAt).toBeNull();
  });
});

describe('teaser lines', () => {
  it('shows only what is new and a tip on a first launch', () => {
    expect(lines(null)).toEqual([
      { label: `New in ${version}`, text: 'First packaged desktop build' },
      { label: `New in ${version}`, text: 'Updates in the background on Stable or Beta' },
      { label: 'Tip', text: '⌥Space starts a chat from anywhere' },
    ]);
  });

  it('teases up to three things from last time, most urgent first', () => {
    const teasers = lines({
      ...quiet,
      running: 2,
      needsYou: 1,
      busy: ['Bolt'],
      waiting: ['Wren', 'Pip'],
    });
    expect(teasers.map((teaser) => teaser.text)).toEqual([
      'Wren and Pip are waiting on you 👀',
      '1 chat needs you',
      '2 chats were still running when you left…',
      'First packaged desktop build',
      '⌥Space starts a chat from anywhere',
    ]);
    expect(teasers[0]?.label).toBe('While you were away');
  });

  it('words pull requests and the morning brief by day', () => {
    const sameDay = lines({ ...quiet, prs: 1, briefAt: '2026-10-02T08:05:00.000Z' });
    expect(sameDay.slice(0, 2).map((teaser) => teaser.text)).toEqual([
      '1 pull request opened today',
      'Your morning brief is ready, made at 8:05 AM',
    ]);
    const nextDay = lines({
      ...quiet,
      savedAt: '2026-10-01T18:00:00.000Z',
      prs: 3,
      briefAt: '2026-10-01T08:05:00.000Z',
      busy: ['Bolt', 'Wren', 'Pip'],
    });
    expect(nextDay.slice(0, 2).map((teaser) => teaser.text)).toEqual([
      'Bolt, Wren and Pip were busy when you left',
      '3 pull requests opened last time',
    ]);
    expect(nextDay[2]?.label).toBe(`New in ${version}`);
  });

  it('leaves out the shortcut tip when the shortcut was changed', () => {
    expect(lines(quiet, false).at(-1)?.text).not.toContain('⌥Space');
  });
});

describe('what is new', () => {
  it('shortens changelog bullets for the current version', () => {
    const notes = [
      '## 1.0.0',
      '',
      '- **Spark Island**: answer cards with Y and N.',
      '- A much longer highlight that goes on, and on, past the sixty character headline limit for a card.',
      '- Third',
      '## 0.9.0',
      '- Old',
    ].join('\n');
    expect(whatsNew(notes, '1.0.0', 2)).toEqual([
      'Spark Island',
      'A much longer highlight that goes on',
    ]);
    expect(whatsNew(notes, '2.0.0', 2)).toEqual([]);
  });
});
