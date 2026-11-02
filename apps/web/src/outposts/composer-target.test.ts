import { describe, expect, it } from 'vitest';
import {
  EMPTY_HINT,
  NOBODY_HINT,
  asked,
  composerTarget,
  handleQuery,
  matchingHandles,
  withHandle,
  uniqueLead,
  type Answering,
} from './composer-target.ts';

const HANDLES = ['fe', 'api'];
const ANSWERING: Answering = {
  postId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  handle: 'fe',
};

describe('composerTarget', () => {
  it('reads text that starts with a member handle as a request', () => {
    expect(composerTarget('@api add the filter', HANDLES, null)).toEqual({
      action: 'request',
      label: 'Send request',
      hint: '',
      to: ['api'],
      body: 'add the filter',
      ready: true,
    });
  });

  it('reads a handle anywhere, and several of them, as one request to each chat', () => {
    expect(composerTarget('tell @api about it', HANDLES, null)).toMatchObject({
      action: 'request',
      to: ['api'],
      body: 'tell @api about it',
    });
    expect(composerTarget('@fe draw what @api returns', HANDLES, null)).toMatchObject({
      action: 'request',
      label: 'Send request',
      to: ['fe', 'api'],
      body: '@fe draw what @api returns',
    });
  });

  it('reads @all as a request to every chat', () => {
    const target = composerTarget('@all agree the endpoint', HANDLES, null);
    expect(target).toMatchObject({ action: 'request', label: 'Send request', to: ['fe', 'api'] });
  });

  it('leaves out a chat the sender chose not to ask', () => {
    expect(composerTarget('@fe draw what @api returns', HANDLES, null, ['api'])).toMatchObject({
      action: 'request',
      to: ['fe'],
      body: 'draw what @api returns',
    });
  });

  it('blocks when every explicit recipient was removed', () => {
    expect(
      composerTarget('@fe draw what @api returns', HANDLES, null, ['api', 'fe'], {
        conversationId: 'lead',
        handle: 'fe',
      }),
    ).toMatchObject({
      action: 'request',
      hint: NOBODY_HINT,
      to: [],
      ready: false,
    });
  });

  it('sends ordinary text unchanged to the chosen lead', () => {
    expect(
      composerTarget('where are we', HANDLES, null, [], { conversationId: 'lead', handle: 'fe' }),
    ).toMatchObject({
      action: 'request',
      to: ['fe'],
      toConversationId: 'lead',
      body: 'where are we',
      ready: true,
    });
  });

  it('requires an available agent and nonempty message', () => {
    expect(composerTarget('where are we', HANDLES, null)).toMatchObject({
      ready: false,
      hint: EMPTY_HINT,
    });
    expect(
      composerTarget('   ', HANDLES, null, [], { conversationId: 'lead', handle: 'fe' }).ready,
    ).toBe(false);
  });

  it('only makes a note when explicitly chosen, including literal mentions', () => {
    expect(
      composerTarget('@all the contract is settled', HANDLES, null, [], null, true),
    ).toMatchObject({
      action: 'note',
      body: '@all the contract is settled',
      to: [],
      ready: true,
    });
  });

  it('blocks unknown handles anywhere without silently asking the lead', () => {
    for (const text of ['@docs write it up', 'please ask @docs about it', '@fe ask @docs']) {
      expect(
        composerTarget(text, HANDLES, null, [], { conversationId: 'lead', handle: 'fe' }),
      ).toMatchObject({
        ready: false,
        hint: 'No chat here is called @docs. Choose a member or correct the handle.',
      });
    }
    expect(
      composerTarget('mail someone@api.dev', HANDLES, null, [], {
        conversationId: 'lead',
        handle: 'fe',
      }).ready,
    ).toBe(true);
  });

  it('sends everything to the selected request while answering', () => {
    expect(composerTarget('@api light theme', HANDLES, ANSWERING)).toEqual({
      action: 'answer',
      label: 'Send answer',
      hint: 'Goes to @fe as your message',
      to: ['fe'],
      body: '@api light theme',
      ready: true,
    });
  });

  it('has no answer to send while the box is empty', () => {
    expect(composerTarget('', HANDLES, ANSWERING).ready).toBe(false);
  });
});

describe('asked', () => {
  it('lists the chats a message will ask, without the ones left out', () => {
    expect(asked('@fe draw what @api returns', HANDLES, [])).toEqual(['fe', 'api']);
    expect(asked('@fe draw what @api returns', HANDLES, ['fe'])).toEqual(['api']);
    expect(asked('nothing here', HANDLES, [])).toEqual([]);
  });
});

describe('handleQuery', () => {
  it('is the handle being typed where the caret is', () => {
    expect(handleQuery('@')).toEqual({ query: '', start: 0 });
    expect(handleQuery('@A')).toEqual({ query: 'a', start: 0 });
    expect(handleQuery('hello @ap')).toEqual({ query: 'ap', start: 6 });
    expect(handleQuery('hello @ap and more', 9)).toEqual({ query: 'ap', start: 6 });
    expect(handleQuery('line one\n@f')).toEqual({ query: 'f', start: 9 });
  });

  it('ends once the handle is followed by anything, and never starts inside a word', () => {
    expect(handleQuery('@api ')).toBeNull();
    expect(handleQuery('hello @ap and more')).toBeNull();
    expect(handleQuery('someone@ap')).toBeNull();
    expect(handleQuery('')).toBeNull();
  });
});

describe('matchingHandles', () => {
  const members = [{ handle: 'fe' }, { handle: 'api' }, { handle: 'api-docs' }];

  it('offers every member for a bare @', () => {
    expect(matchingHandles({ query: '', start: 0 }, members)).toEqual(members);
  });

  it('narrows by prefix and offers nothing without a query', () => {
    const narrowed = matchingHandles({ query: 'ap', start: 0 }, members);
    expect(narrowed.map((member) => member.handle)).toEqual(['api', 'api-docs']);
    expect(matchingHandles(null, members)).toEqual([]);
  });

  it('offers nothing once the only match is typed in full, so Enter sends', () => {
    expect(matchingHandles({ query: 'fe', start: 0 }, members)).toEqual([]);
    expect(matchingHandles({ query: 'api-docs', start: 0 }, members)).toEqual([]);
    expect(matchingHandles({ query: 'api', start: 0 }, members)).toHaveLength(2);
  });
});

describe('withHandle', () => {
  it('leaves the box ready for the request text', () => {
    expect(withHandle('@a', { query: 'a', start: 0 }, 2, 'api')).toEqual({
      text: '@api ',
      caret: 5,
    });
  });

  it('completes a handle in the middle of the text and keeps what follows', () => {
    expect(withHandle('ask @a for it', { query: 'a', start: 4 }, 6, 'api')).toEqual({
      text: 'ask @api for it',
      caret: 9,
    });
  });
});

describe('uniqueLead', () => {
  const members = [
    { conversationId: 'first', archived: false },
    { conversationId: 'second', archived: false },
    { conversationId: 'old', archived: true },
  ];
  it('uses one valid lead even across multiple stories', () => {
    expect(
      uniqueLead(members, [
        { leadConversationId: 'second' },
        { leadConversationId: 'second' },
        { leadConversationId: 'old' },
        { leadConversationId: 'gone' },
      ]),
    ).toBe('second');
  });
  it('falls back when stories disagree or have no active lead', () => {
    expect(
      uniqueLead(members, [{ leadConversationId: 'first' }, { leadConversationId: 'second' }]),
    ).toBeNull();
    expect(
      uniqueLead(members, [{ leadConversationId: 'old' }, { leadConversationId: null }]),
    ).toBeNull();
  });
});
