import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  chatChoices,
  formOf,
  hasChanges,
  sheetChanges,
  sheetProblems,
  withHandleFor,
  withMember,
  withoutMember,
  type SheetForm,
} from './sheet-draft.ts';
import {
  API_CHAT,
  DOCS_CHAT,
  FE_CHAT,
  OUTPOST_ID,
  WEB_PROJECT,
  chat,
  member,
  outpost,
} from './test-fixtures.ts';

const CHATS = [
  chat(FE_CHAT, { title: 'Usage page' }),
  chat(API_CHAT, { title: 'Usage endpoint' }),
  chat(DOCS_CHAT, { title: 'API reference' }),
];

const FORM: SheetForm = {
  name: 'Usage by user',
  members: [
    { conversationId: FE_CHAT, handle: 'fe' },
    { conversationId: API_CHAT, handle: 'api' },
  ],
};

describe('sheetProblems', () => {
  it('accepts a named outpost with distinct handles, and one with no chats yet', () => {
    expect(sheetProblems(FORM, CHATS)).toEqual([]);
    expect(sheetProblems({ name: 'Empty room', members: [] }, CHATS)).toEqual([]);
  });

  it('needs a name of at most 60 characters', () => {
    expect(sheetProblems({ ...FORM, name: '  ' }, CHATS)).toEqual([
      { field: 'name', conversationId: null, message: 'Enter a name.' },
    ]);
    expect(sheetProblems({ ...FORM, name: 'x'.repeat(61) }, CHATS)[0]?.message).toBe(
      'A name can have at most 60 characters.',
    );
  });

  it('reports a duplicate handle on each chat that uses it', () => {
    const form = withHandleFor(FORM, API_CHAT, 'fe');
    expect(sheetProblems(form, CHATS)).toEqual([
      { field: 'handle', conversationId: FE_CHAT, message: '@fe is already used in this outpost.' },
      {
        field: 'handle',
        conversationId: API_CHAT,
        message: '@fe is already used in this outpost.',
      },
    ]);
  });

  it('uses the shared handle rules for reserved and malformed handles', () => {
    expect(sheetProblems(withHandleFor(FORM, FE_CHAT, 'all'), CHATS)[0]?.message).toBe(
      '@all is reserved. Choose another handle.',
    );
    expect(sheetProblems(withHandleFor(FORM, FE_CHAT, ''), CHATS)[0]?.message).toBe(
      'Enter a handle.',
    );
  });

  it('refuses a Terminal session and a chat that is in another outpost', () => {
    const chats = [
      chat(FE_CHAT, { sessionType: 'terminal' }),
      chat(API_CHAT, {
        outpost: { id: '0a000000-0000-4000-8000-000000000009', name: 'Orders', handle: 'api' },
      }),
    ];
    expect(sheetProblems(FORM, chats).map((problem) => problem.message)).toEqual([
      'Terminal sessions cannot join an outpost. Remove it.',
      'Already in Orders. Remove it.',
    ]);
  });

  it('lets a chat stay in its own outpost, archived or not', () => {
    const chats = [
      chat(FE_CHAT, {
        archivedAt: '2026-10-09T11:00:00.000Z',
        outpost: { id: OUTPOST_ID, name: 'Usage by user', handle: 'fe' },
      }),
      chat(API_CHAT),
    ];
    expect(sheetProblems(FORM, chats, OUTPOST_ID)).toEqual([]);
  });

  it('flags a chat that was deleted while the sheet was open', () => {
    expect(sheetProblems(FORM, [chat(FE_CHAT)])).toEqual([
      {
        field: 'members',
        conversationId: API_CHAT,
        message: 'This chat no longer exists. Remove it.',
      },
    ]);
  });

  it('caps the number of chats', () => {
    const members = Array.from({ length: 51 }, (_, index) => ({
      conversationId: `0c000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      handle: `chat${index + 100}`,
    }));
    const chats = members.map((entry) => chat(entry.conversationId));
    expect(sheetProblems({ name: 'Big', members }, chats)).toEqual([
      { field: 'members', conversationId: null, message: 'An outpost can have at most 50 chats.' },
    ]);
  });
});

describe('chatChoices', () => {
  it('offers unarchived chats that are not in the form and says why one cannot be picked', () => {
    const chats = [
      ...CHATS,
      chat('0c000000-0000-4000-8000-000000000004', { title: 'Shell', sessionType: 'terminal' }),
      chat('0c000000-0000-4000-8000-000000000005', {
        title: 'Old',
        archivedAt: '2026-10-01T00:00:00.000Z',
      }),
    ];
    expect(
      chatChoices(FORM, chats).map((choice) => [choice.chat.title, choice.unavailableReason]),
    ).toEqual([
      ['API reference', null],
      ['Shell', 'Terminal sessions cannot join an outpost'],
    ]);
  });
});

describe('editing the form', () => {
  it('suggests a handle from the project name, then from the chat title', () => {
    const inProject = chat(DOCS_CHAT, { title: 'API reference', projectIds: [WEB_PROJECT] });
    expect(withMember(EMPTY_FORM, inProject, { [WEB_PROJECT]: 'Handbook' }).members).toEqual([
      { conversationId: DOCS_CHAT, handle: 'handbook' },
    ]);
    expect(withMember(EMPTY_FORM, chat(DOCS_CHAT, { title: 'API reference' }), {}).members).toEqual(
      [{ conversationId: DOCS_CHAT, handle: 'api-reference' }],
    );
  });

  it('suggests a free handle and never adds a chat twice', () => {
    const next = withMember(FORM, chat(DOCS_CHAT, { title: 'API' }), {});
    expect(next.members.at(-1)).toEqual({ conversationId: DOCS_CHAT, handle: 'api2' });
    expect(withMember(next, chat(DOCS_CHAT), {})).toBe(next);
  });

  it('removes a chat and normalises a typed handle', () => {
    expect(withoutMember(FORM, FE_CHAT).members).toEqual([
      { conversationId: API_CHAT, handle: 'api' },
    ]);
    expect(withHandleFor(FORM, FE_CHAT, '@Web').members[0]).toEqual({
      conversationId: FE_CHAT,
      handle: 'web',
    });
  });
});

describe('sheetChanges', () => {
  const initial = formOf(
    outpost({ members: [member(API_CHAT, 'api', 2), member(FE_CHAT, 'fe', 1)] }),
  );

  it('reads the form from an outpost in member order', () => {
    expect(initial).toEqual(FORM);
  });

  it('is empty when nothing changed', () => {
    const changes = sheetChanges(initial, { ...FORM, name: ' Usage by user ' });
    expect(changes).toEqual({ name: null, put: [], remove: [] });
    expect(hasChanges(changes)).toBe(false);
  });

  it('names the rename, the added and renamed chats, and the removed ones', () => {
    const form: SheetForm = {
      name: 'Usage filter',
      members: [
        { conversationId: FE_CHAT, handle: 'web' },
        { conversationId: DOCS_CHAT, handle: 'docs' },
      ],
    };
    const changes = sheetChanges(initial, form);
    expect(changes).toEqual({
      name: 'Usage filter',
      put: [
        { conversationId: FE_CHAT, handle: 'web' },
        { conversationId: DOCS_CHAT, handle: 'docs' },
      ],
      remove: [API_CHAT],
    });
    expect(hasChanges(changes)).toBe(true);
  });
});
