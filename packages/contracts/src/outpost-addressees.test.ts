import { describe, expect, it } from 'vitest';
import { addressees, mentionsSomeone, requestFor, userAddress } from './outpost-addressees.ts';

const HANDLES = ['fe', 'api', 'api-v2'];

describe('addressees', () => {
  it('reads a member handle anywhere in the message', () => {
    expect(addressees('ask @api for the shape', HANDLES)).toEqual(['api']);
    expect(addressees('@api what does orders return?', HANDLES)).toEqual(['api']);
    expect(addressees('what does orders return, @api', HANDLES)).toEqual(['api']);
    expect(addressees('line one\n@fe line two', HANDLES)).toEqual(['fe']);
  });

  it('reads any number of handles, in the order they are typed', () => {
    expect(addressees('@fe build the page, @api add the endpoint', HANDLES)).toEqual(['fe', 'api']);
    expect(addressees('cc @api-v2 @fe @api', HANDLES)).toEqual(['api-v2', 'fe', 'api']);
  });

  it('counts a handle typed twice once', () => {
    expect(addressees('@api first, then @fe, then @api again', HANDLES)).toEqual(['api', 'fe']);
  });

  it('reads @all anywhere as every member', () => {
    expect(addressees('@all rebase on main', HANDLES)).toEqual(HANDLES);
    expect(addressees('please rebase, @all', HANDLES)).toEqual(HANDLES);
    expect(addressees('@All rebase', HANDLES)).toEqual(HANDLES);
    expect(addressees('@all rebase', [])).toEqual([]);
  });

  it('keeps the typed order first when @all comes with other handles', () => {
    expect(addressees('@api first, then @all', HANDLES)).toEqual(['api', 'fe', 'api-v2']);
  });

  it('leaves out a handle no member has', () => {
    expect(addressees('@docs and @api, sync up', HANDLES)).toEqual(['api']);
    expect(addressees('@docs update the guide', HANDLES)).toEqual([]);
    expect(addressees('@apis and @api-v3', HANDLES)).toEqual([]);
  });

  it('reads the whole handle, not a member handle it starts with', () => {
    expect(addressees('ask @api-v2 first', HANDLES)).toEqual(['api-v2']);
  });

  it('ignores a handle joined to other characters', () => {
    for (const text of [
      'someone@api.dev wrote in',
      'foo@api is the alias',
      "@api's endpoint is slow",
      '@api.orders is slow',
      '@api/fe sync',
      '@ api hi',
      'see docs/@api for more',
      '@@api',
    ]) {
      expect(addressees(text, HANDLES)).toEqual([]);
    }
  });

  it('accepts punctuation around a handle', () => {
    for (const text of [
      'thanks @api.',
      'is that right, @api?',
      '@api: add the endpoint',
      '@api, add the endpoint',
      'both of you (@api) please',
      'done by "@api"',
      'over to @api!',
      'ping @api...',
    ]) {
      expect(addressees(text, HANDLES)).toEqual(['api']);
    }
  });

  it('matches a handle in any letter case', () => {
    expect(addressees('ask @API and @Fe', HANDLES)).toEqual(['api', 'fe']);
  });
});

describe('userAddress', () => {
  it('is a request to every chat the message addresses, with the message as typed', () => {
    expect(userAddress('  @fe build the page, @api add the endpoint  ', HANDLES)).toEqual({
      kind: 'request',
      to: ['fe', 'api'],
      body: '@fe build the page, @api add the endpoint',
    });
    expect(userAddress('ask @api for the shape', HANDLES)).toEqual({
      kind: 'request',
      to: ['api'],
      body: 'ask @api for the shape',
    });
  });

  it('keeps a request that is one leading handle as it was: the handle is not part of the text', () => {
    expect(userAddress('@api: add the endpoint', HANDLES)).toEqual({
      kind: 'request',
      to: ['api'],
      body: 'add the endpoint',
    });
    expect(userAddress('@API\nadd the endpoint\n\nthen open a PR', HANDLES)).toEqual({
      kind: 'request',
      to: ['api'],
      body: 'add the endpoint\n\nthen open a PR',
    });
  });

  it('is a note without a member handle', () => {
    expect(userAddress('The orders response is now paged.', HANDLES)).toEqual({
      kind: 'note',
      body: 'The orders response is now paged.',
    });
    expect(userAddress('@docs update the guide', HANDLES).kind).toBe('note');
    expect(userAddress('   ', HANDLES)).toEqual({ kind: 'note', body: '' });
  });

  it('is a note when the message says nothing but handles', () => {
    expect(userAddress('@api', HANDLES)).toEqual({ kind: 'note', body: '@api' });
    expect(userAddress('@api:', HANDLES).kind).toBe('note');
    expect(userAddress('@fe @api', HANDLES).kind).toBe('note');
    expect(userAddress('@all', HANDLES).kind).toBe('note');
  });

  it('asks only the chats the sender kept', () => {
    expect(userAddress('@fe build it with what @api returns', HANDLES, ['fe'])).toEqual({
      kind: 'request',
      to: ['fe'],
      body: 'build it with what @api returns',
    });
    expect(userAddress('@fe build it with what @api returns', HANDLES, ['api'])).toEqual({
      kind: 'request',
      to: ['api'],
      body: '@fe build it with what @api returns',
    });
    expect(userAddress('@all rebase on main', HANDLES, ['api', 'fe'])).toMatchObject({
      to: ['fe', 'api'],
      body: '@all rebase on main',
    });
  });

  it('is a note when the sender kept nobody', () => {
    expect(userAddress('@fe and @api are both green', HANDLES, [])).toEqual({
      kind: 'note',
      body: '@fe and @api are both green',
    });
  });

  it('never asks a chat the message does not address', () => {
    expect(userAddress('@fe build the page', HANDLES, ['fe', 'api'])).toMatchObject({ to: ['fe'] });
    expect(userAddress('build the page', HANDLES, ['api']).kind).toBe('note');
  });

  it('leaves a slash command after one leading handle as the command', () => {
    expect(userAddress('@api /compact', HANDLES)).toEqual({
      kind: 'request',
      to: ['api'],
      body: '/compact',
    });
  });

  it('keeps a slash command with several chats as text with its handles', () => {
    expect(userAddress('@api @fe /compact', HANDLES)).toEqual({
      kind: 'request',
      to: ['api', 'fe'],
      body: '@api @fe /compact',
    });
    expect(userAddress('/compact @api @fe', HANDLES).body).toBe('/compact @api @fe');
  });
});

describe('mentionsSomeone', () => {
  it('is true for text that carries a handle standing alone', () => {
    expect(mentionsSomeone('/compact @api @fe')).toBe(true);
    expect(mentionsSomeone('/review for @all')).toBe(true);
  });

  it('is false for a bare command or an address joined to other characters', () => {
    expect(mentionsSomeone('/compact')).toBe(false);
    expect(mentionsSomeone('/review someone@api.dev')).toBe(false);
  });
});

describe('requestFor', () => {
  const asked = ['api', 'web'];
  const both =
    '@api add a GET /health route (one line). @web add an <h1>Todos</h1> heading. Each of you: reply with your handle.';

  it('gives each chat the text addressed to it, a shared tail going to the last part', () => {
    expect(requestFor(both, 'api', asked)).toBe('add a GET /health route (one line).');
    expect(requestFor(both, 'web', asked)).toBe(
      'add an <h1>Todos</h1> heading. Each of you: reply with your handle.',
    );
  });

  it('leaves out the word that joins one part to the next', () => {
    const text = 'Before Friday: @api list the order fields and @web name the page.';
    expect(requestFor(text, 'api', asked)).toBe('list the order fields');
    expect(requestFor(text, 'web', asked)).toBe('name the page.');
  });

  it('shares the text after handles that are typed together', () => {
    expect(requestFor('@api @web review the README', 'api', asked)).toBe('review the README');
    expect(requestFor('@api and @web: review the README', 'web', asked)).toBe('review the README');
  });

  it('keeps the whole message for @all, one chat, or a handle that was not asked', () => {
    expect(requestFor('@all @api fix it', 'api', asked)).toBe('@all @api fix it');
    expect(requestFor('@api fix it. @web too', 'api', ['api'])).toBe('@api fix it. @web too');
    expect(requestFor('@api fix it. @docs check it', 'docs', asked)).toBe(
      '@api fix it. @docs check it',
    );
  });

  it('splits only on asked handles and leaves text before the first handle out', () => {
    expect(requestFor('Today: @api fix @someone’s bug. @web restyle', 'api', asked)).toBe(
      'fix @someone’s bug.',
    );
  });

  it('falls back to the whole message when its part says nothing', () => {
    expect(requestFor('please do it @api. @web', 'web', asked)).toBe('please do it @api. @web');
  });
});
