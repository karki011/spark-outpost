import { describe, expect, it } from 'vitest';
import type { OutpostLibraryChats, OutpostSuggestions } from '@spark-outpost/contracts';
import { outpostLibrary } from './outpost-library.ts';
import { suggestionsOf } from './SuggestedThreads.tsx';
import type { MemberView } from './member-view.ts';

const API = '11111111-1111-4111-8111-111111111111';
const WEB = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const library: OutpostLibraryChats = {
  chats: [
    {
      conversationId: API,
      files: [{ id: '44444444-4444-4444-8444-444444444444', name: 'notes.txt', size: 2048 }],
      artifacts: [
        { id: '55555555-5555-4555-8555-555555555555', title: 'Plan', kind: 'html', versions: 3 },
      ],
    },
    { conversationId: WEB, files: [], artifacts: [] },
  ],
};

describe('outpostLibrary', () => {
  it('labels each entry with its chat and size or version', () => {
    const shown = outpostLibrary(
      [
        { conversationId: API, handle: 'api' },
        { conversationId: WEB, handle: 'web' },
      ],
      library,
    );
    expect(shown.files).toEqual([
      {
        id: expect.any(String),
        name: 'notes.txt',
        meta: '2 KB',
        conversationId: API,
        handle: 'api',
      },
    ]);
    expect(shown.artifacts).toEqual([
      {
        id: expect.any(String),
        name: 'Plan',
        meta: 'HTML · version 3',
        conversationId: API,
        handle: 'api',
      },
    ]);
  });

  it('is empty before the read arrives', () => {
    expect(outpostLibrary([{ conversationId: API, handle: 'api' }], undefined)).toEqual({
      artifacts: [],
      files: [],
    });
  });
});

describe('suggestionsOf', () => {
  it('pairs each draft with the member chat that proposed it and drops other chats', () => {
    const members = [{ conversationId: API, handle: 'api' }] as MemberView[];
    const suggested: OutpostSuggestions = {
      drafts: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          conversationId: API,
          runId: null,
          chats: 2,
          stacked: 0,
          outpostId: null,
          startedAt: null,
        },
        {
          id: '77777777-7777-4777-8777-777777777777',
          conversationId: OTHER,
          runId: null,
          chats: 1,
          stacked: 0,
          outpostId: null,
          startedAt: null,
        },
      ],
    };
    const [only, ...rest] = suggestionsOf(members, suggested);
    expect(rest).toEqual([]);
    expect(only?.member.handle).toBe('api');
    expect(only?.draft).toMatchObject({ id: '66666666-6666-4666-8666-666666666666', chats: 2 });
    expect(only?.draft).not.toHaveProperty('conversationId');
  });
});
