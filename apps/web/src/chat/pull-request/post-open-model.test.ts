import { describe, expect, it } from 'vitest';
import { offerNote, offersFollowUp, openedSummary, ticketLines } from './post-open-model.ts';
import { watch } from './watch-fixture.ts';

describe('offersFollowUp', () => {
  it('offers only when follow-up is off or asks first', () => {
    expect(offersFollowUp(watch(), 'off')).toBe(true);
    expect(offersFollowUp(watch(), 'ask')).toBe(true);
    expect(offersFollowUp(watch(), 'on')).toBe(false);
  });

  it('offers only for an open pull request this chat opened on its own branch', () => {
    expect(offersFollowUp(watch({ prState: 'merged' }), 'off')).toBe(false);
    expect(offersFollowUp(watch({ followUp: false }), 'off')).toBe(false);
    const found = watch({ opened: { ...watch().opened, via: 'discovery' } });
    expect(offersFollowUp(found, 'off')).toBe(false);
  });
});

describe('offerNote', () => {
  it('names the setting Turn on changes', () => {
    expect(offerNote('off')).toBe(
      'Turns on Follow up on pull requests in Settings, for every pull request.',
    );
    expect(offerNote('ask')).toBe(
      'Turns off Ask before pushing and replying in Settings, for every pull request.',
    );
  });
});

describe('ticketLines', () => {
  it('says which tickets were not moved and why, and nothing for a move that went through', () => {
    const lines = ticketLines({
      ticketSync: [
        { source: 'jira', key: 'WEB-1', outcome: 'succeeded', message: null },
        {
          source: 'jira',
          key: 'WEB-2',
          outcome: 'skipped',
          message: 'Left at Done; it is further along than In review.',
        },
        { source: 'linear', key: 'ENG-3', outcome: 'failed', message: null },
      ],
    });
    expect(lines).toEqual([
      'WEB-2 was not moved to review: Left at Done; it is further along than In review.',
      'ENG-3 was not moved to review: the ticket system did not take the move.',
    ]);
  });
});

describe('openedSummary', () => {
  it('keeps the single pull request line', () => {
    expect(openedSummary([{ repo: 'acme/app' }])).toEqual({
      title: 'Opened pull request',
      sharedRepo: 'acme/app',
    });
  });

  it('counts several pull requests and names a repository only when they share it', () => {
    expect(openedSummary([{ repo: 'acme/app' }, { repo: 'acme/app' }])).toEqual({
      title: 'Opened 2 pull requests',
      sharedRepo: 'acme/app',
    });
    expect(openedSummary([{ repo: 'acme/app' }, { repo: 'acme/web' }])).toEqual({
      title: 'Opened 2 pull requests',
      sharedRepo: null,
    });
  });
});
