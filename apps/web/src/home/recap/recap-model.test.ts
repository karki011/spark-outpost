import { describe, expect, it } from 'vitest';
import type { RecapBody, RecapRefine, RecapState } from '@spark-outpost/contracts';
import { copyText, latestRefined, plainText, recapView, totalsLine } from './recap-model.ts';

const body: RecapBody = {
  done: [
    {
      me: 'I shipped the download prompt (#182).',
      manager: 'Downloads ask before saving (#182).',
      url: 'https://github.com/o/r/pull/182',
      chatId: null,
    },
    { me: 'I fixed a typo.', manager: 'Typo fixed.', url: null, chatId: null },
  ],
  progress: [],
  help: [{ me: 'Release waits on Apple.', manager: 'Need the Apple account owner.', url: null, chatId: null }],
  you: [{ me: 'A chat waits on my answer.', manager: null, url: null, chatId: null }],
};

describe('copy text', () => {
  it('takes the lead item of each section in the chosen voice and links its number', () => {
    expect(copyText(body, 'manager')).toBe(
      '**Done this week:** Downloads ask before saving ([#182](https://github.com/o/r/pull/182)).\n' +
        '**Could use your help:** Need the Apple account owner.',
    );
    expect(copyText(body, 'me')).toContain('**Done this week:** I shipped the download prompt');
    expect(copyText(body, 'me')).not.toContain('waits on my answer');
  });

  it('turns Markdown into plain text', () => {
    expect(plainText('**Done:** _shipped_ [#1](https://x.dev/1)')).toBe(
      'Done: shipped #1 (https://x.dev/1)',
    );
  });
});

it('uses the latest finished rewrite for a voice', () => {
  const refine = (voice: 'me' | 'manager', textOut: string | null, status = 'ready') =>
    ({ voice, textOut, status }) as RecapRefine;
  expect(
    latestRefined(
      [refine('manager', 'one'), refine('me', 'mine'), refine('manager', 'two'), refine('manager', null, 'running')],
      'manager',
    ),
  ).toBe('two');
  expect(latestRefined([], 'me')).toBeNull();
});

it('counts only what happened', () => {
  expect(totalsLine({ chats: 1, merged: 0, open: 2, tickets: 1 })).toBe(
    '1 chat · 2 open · 1 ticket moved',
  );
});

it('shows the card when due, offers it early, and hides it without a provider or when off', () => {
  const base: RecapState = { available: true, enabled: true, due: false, recap: null, refines: [] };
  expect(recapView(undefined)).toBe('hidden');
  expect(recapView({ ...base, available: false })).toBe('hidden');
  expect(recapView(base)).toBe('early');
  expect(recapView({ ...base, due: true })).toBe('offer');
  expect(recapView({ ...base, enabled: false, due: true })).toBe('hidden');
});
