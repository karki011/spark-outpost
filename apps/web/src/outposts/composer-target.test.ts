import { describe, expect, it } from 'vitest';
import {
  EMPTY_HINT,
  composerTarget,
  handleQuery,
  matchingHandles,
  withHandle,
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
      hint: 'Starts a turn in @api',
      to: 'api',
      body: 'add the filter',
      ready: true,
    });
  });

  it('reads anything else as a note', () => {
    const target = composerTarget('the contract is settled', HANDLES, null);
    expect(target.action).toBe('note');
    expect(target.label).toBe('Post note');
    expect(target.body).toBe('the contract is settled');
    expect(target.ready).toBe(true);
  });

  it('has nothing to send for an empty box and explains the two kinds', () => {
    const target = composerTarget('   ', HANDLES, null);
    expect(target.action).toBe('note');
    expect(target.ready).toBe(false);
    expect(target.hint).toBe(EMPTY_HINT);
  });

  it('says so when the leading handle is not a member', () => {
    const target = composerTarget('@docs write it up', HANDLES, null);
    expect(target.action).toBe('note');
    expect(target.hint).toBe('No chat here is called @docs. This posts as a note.');
  });

  it('keeps a handle in the middle of a sentence a note', () => {
    expect(composerTarget('tell @api about it', HANDLES, null).action).toBe('note');
  });

  it('reads @all as a request to everyone', () => {
    const target = composerTarget('@all agree the endpoint', HANDLES, null);
    expect(target.action).toBe('all');
    expect(target.label).toBe('Send to all');
    expect(target.body).toBe('agree the endpoint');
  });

  it('sends everything to the selected request while answering', () => {
    expect(composerTarget('@api light theme', HANDLES, ANSWERING)).toEqual({
      action: 'answer',
      label: 'Send answer',
      hint: 'Goes to @fe as your message',
      to: 'fe',
      body: '@api light theme',
      ready: true,
    });
  });

  it('has no answer to send while the box is empty', () => {
    expect(composerTarget('', HANDLES, ANSWERING).ready).toBe(false);
  });
});

describe('handleQuery', () => {
  it('is the handle being typed at the very start of the box', () => {
    expect(handleQuery('@')).toBe('');
    expect(handleQuery('@A')).toBe('a');
    expect(handleQuery('@api')).toBe('api');
  });

  it('ends once the handle is followed by anything', () => {
    expect(handleQuery('@api ')).toBeNull();
    expect(handleQuery('hello @a')).toBeNull();
    expect(handleQuery('')).toBeNull();
  });
});

describe('matchingHandles', () => {
  const members = [{ handle: 'fe' }, { handle: 'api' }, { handle: 'api-docs' }];

  it('offers every member for a bare @', () => {
    expect(matchingHandles('', members)).toEqual(members);
  });

  it('narrows by prefix and offers nothing without a query', () => {
    expect(matchingHandles('ap', members).map((member) => member.handle)).toEqual([
      'api',
      'api-docs',
    ]);
    expect(matchingHandles(null, members)).toEqual([]);
  });
});

describe('withHandle', () => {
  it('leaves the box ready for the request text', () => {
    expect(withHandle('api')).toBe('@api ');
  });
});
