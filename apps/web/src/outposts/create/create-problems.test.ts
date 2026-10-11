import { describe, expect, it } from 'vitest';
import { OUTPOST_MEMBERS_MAX } from '@spark-outpost/contracts';
import { API_CHAT, DOCS_CHAT, FE_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from '../test-fixtures.ts';
import { emptyChat, patchChat } from './create-draft.ts';
import {
  CODEX,
  countingIds,
  draftOf,
  existing,
  file,
  fresh,
  storyDraft,
  withTask,
} from './create-fixtures.ts';
import {
  TERMINAL_CANNOT_JOIN,
  chatProblems,
  continueBlock,
  draftProblems,
  isFinished,
  nameProblem,
} from './create-problems.ts';

const CHATS = [
  chat(FE_CHAT, { title: 'Usage page' }),
  chat(API_CHAT, { title: 'Rate limit headers' }),
  chat(DOCS_CHAT, { title: 'Terminal: Claude in web', sessionType: 'terminal' }),
];

function problemsOf(...chats: Parameters<typeof draftOf>[0]) {
  return draftProblems(draftOf(chats), CHATS).map(({ field, message, suggestions }) => ({
    field,
    message,
    suggestions,
  }));
}

describe('the name', () => {
  it('is needed and has a longest length', () => {
    expect(nameProblem('  ')).toBe('Enter a name.');
    expect(nameProblem('x'.repeat(61))).toBe('A name can have at most 60 characters.');
    expect(nameProblem(' Usage by user ')).toBeNull();
  });
});

describe('chat problems', () => {
  it('finds nothing in two chats with their own handles', () => {
    const ids = countingIds();
    expect(problemsOf(existing(ids, FE_CHAT, 'fe'), fresh(ids, WEB_PROJECT, 'api'))).toEqual([]);
  });

  it('ignores a form nobody touched', () => {
    const untouched = emptyChat(CODEX, countingIds());
    const draft = draftOf([untouched]);
    expect(chatProblems(untouched, draft, CHATS)).toEqual([]);
    expect(isFinished(untouched, draft, CHATS)).toBe(false);
    expect(continueBlock(draft, CHATS)).toBeNull();
  });

  it('names the second chat of a shared handle and offers two others', () => {
    const ids = countingIds();
    expect(problemsOf(fresh(ids, WEB_PROJECT, 'api'), existing(ids, API_CHAT, 'api'))).toEqual([
      {
        field: 'handle',
        message: 'Two chats cannot share @api.',
        suggestions: ['api2', 'rate-limit-headers'],
      },
    ]);
  });

  it('says a new chat needs a project, and an agent', () => {
    const ids = countingIds();
    expect(problemsOf(fresh(ids, null, 'docs'))).toEqual([
      { field: 'project', message: 'A new chat needs a project.', suggestions: [] },
    ]);
    const noAgent = { ...fresh(ids, WEB_PROJECT, 'docs'), provider: null };
    expect(problemsOf(noAgent)[0]).toMatchObject({ field: 'agent' });
  });

  it('refuses a Terminal session, a chat in another outpost and a chat that is gone', () => {
    const ids = countingIds();
    const elsewhere = chat(API_CHAT, {
      outpost: { id: FE_CHAT, name: 'Orders launch', handle: 'api' },
    });
    expect(problemsOf(existing(ids, DOCS_CHAT, 'term'))[0]?.message).toBe(TERMINAL_CANNOT_JOIN);
    expect(draftProblems(draftOf([existing(ids, API_CHAT, 'api')]), [elsewhere])[0]?.message).toBe(
      'Already in Orders launch. A chat belongs to one outpost.',
    );
    expect(draftProblems(draftOf([existing(ids, API_CHAT, 'api')]), [])[0]?.message).toBe(
      'This chat no longer exists. Remove it.',
    );
  });

  it('asks for a chat before anything else when none is picked', () => {
    const ids = countingIds();
    const typed = patchChat(
      draftOf([emptyChat(CODEX, ids)]),
      '0e000000-0000-4000-8000-000000000001',
      {
        text: 'Hello',
      },
    );
    expect(draftProblems(typed, CHATS).map((problem) => problem.field)).toEqual(['chat']);
  });

  it('checks the shape of a handle with the sentences used everywhere', () => {
    const ids = countingIds();
    expect(problemsOf(existing(ids, FE_CHAT, ''))[0]?.message).toBe('Enter a handle.');
    expect(problemsOf(existing(ids, FE_CHAT, 'all'))[0]?.message).toBe(
      '@all is reserved. Choose another handle.',
    );
  });

  it('holds a first message until its files are ready and it has words', () => {
    const ids = countingIds();
    const uploading = { ...existing(ids, FE_CHAT, 'fe'), text: 'Go', filesPending: true };
    const wordless = { ...existing(ids, API_CHAT, 'api'), files: [file(1)] };
    expect(problemsOf(uploading, wordless).map((problem) => problem.message)).toEqual([
      'A file is still uploading or failed. Wait, retry or remove it.',
      'Write the message, or remove its files.',
    ]);
  });
});

describe('continuing', () => {
  it('is blocked with a count of what to fix', () => {
    const ids = countingIds();
    const one = draftOf([fresh(ids, null, 'docs')]);
    const two = draftOf([fresh(ids, null, 'docs'), existing(ids, FE_CHAT, 'docs')]);
    expect(continueBlock(one, CHATS)).toBe('1 thing to fix');
    expect(continueBlock(two, CHATS)).toBe('2 things to fix');
  });

  it('is blocked by more chats than an outpost can hold', () => {
    const ids = countingIds();
    const many = Array.from({ length: OUTPOST_MEMBERS_MAX + 1 }, (_, index) =>
      fresh(ids, WEB_PROJECT, `chat${index}`),
    );
    expect(continueBlock(draftOf(many), CHATS)).toBe(
      `An outpost can have at most ${OUTPOST_MEMBERS_MAX} chats.`,
    );
  });
});

describe('a sheet opened from a draft', () => {
  const LEAD = '0c000000-0000-4000-8000-000000000007';
  const KNOWN = [...CHATS, chat(LEAD, { title: 'Checkout plan' })];

  function story() {
    const ids = countingIds();
    const lead = existing(ids, LEAD, 'lead');
    const api = withTask(fresh(ids, WEB_PROJECT, 'api'), 'Add the endpoint.');
    const fe = withTask(fresh(ids, WEB_PROJECT, 'fe'), 'Call it.', api.key);
    return { lead, api, fe };
  }

  function found(draft: ReturnType<typeof storyDraft>) {
    return draftProblems(draft, KNOWN).map(({ field, message }) => [field, message]);
  }

  it('finds nothing in a chain of sub-tasks with first messages', () => {
    const { lead, api, fe } = story();
    expect(found(storyDraft([lead, api, fe], LEAD))).toEqual([]);
    expect(continueBlock(storyDraft([lead, api, fe], LEAD), KNOWN)).toBeNull();
  });

  it('needs a first message on both ends of a starts-after edge', () => {
    const { lead, api, fe } = story();
    expect(found(storyDraft([lead, api, { ...fe, text: '' }], LEAD))).toEqual([
      ['after', '@fe needs a first message to start after @api.'],
    ]);
    expect(found(storyDraft([lead, { ...api, text: ' ' }, fe], LEAD))).toEqual([
      ['after', '@api has no first message, so nothing can start after it.'],
    ]);
  });

  it('names chats that wait for each other, once', () => {
    const { lead, api, fe } = story();
    const looped = storyDraft([lead, { ...api, dependsOn: fe.key }, fe], LEAD);
    expect(found(looped)).toEqual([
      ['after', 'These chats wait for each other: @api → @fe → @api.'],
    ]);
    expect(continueBlock(looped, KNOWN)).toBe('1 thing to fix');
  });

  it('refuses a first message for the chat that proposed the draft', () => {
    const { lead, api } = story();
    expect(found(storyDraft([withTask(lead, 'Do it yourself.'), api], LEAD))).toEqual([
      ['message', 'The chat that proposed this draft cannot get a first message from itself.'],
    ]);
  });

  it('needs the proposing chat in the outpost', () => {
    const { api, fe } = story();
    const draft = storyDraft([api, fe], LEAD);
    expect(continueBlock(draft, KNOWN)).toBe('Add the chat that proposed this draft');
    const into = {
      outpostId: OUTPOST_ID,
      name: 'Usage by user',
      members: [{ conversationId: LEAD, handle: 'lead' }],
    };
    expect(continueBlock({ ...draft, into }, KNOWN)).toBeNull();
  });

  it('keeps a new handle clear of the chats already in the outpost', () => {
    const { api } = story();
    const into = {
      outpostId: OUTPOST_ID,
      name: 'Usage by user',
      members: [
        { conversationId: LEAD, handle: 'lead' },
        { conversationId: FE_CHAT, handle: 'api' },
      ],
    };
    const problems = draftProblems({ ...storyDraft([api], LEAD), into }, KNOWN);
    expect(
      problems.map(({ field, message, suggestions }) => [field, message, suggestions]),
    ).toEqual([['handle', 'Two chats cannot share @api.', ['api2']]]);
  });

  it('ignores starts-after in a sheet opened by hand', () => {
    const { api, fe } = story();
    expect(draftProblems(draftOf([api, { ...fe, text: '' }]), KNOWN)).toEqual([]);
  });
});
