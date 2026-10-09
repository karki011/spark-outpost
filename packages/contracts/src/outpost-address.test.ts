import { describe, expect, it } from 'vitest';
import { parseAddress } from './outpost-address.ts';

const HANDLES = ['fe', 'api', 'api-v2'];

describe('parseAddress', () => {
  it('reads a leading member handle as a request', () => {
    expect(parseAddress('@api what does the orders response look like?', HANDLES)).toEqual({
      kind: 'request',
      to: 'api',
      body: 'what does the orders response look like?',
    });
  });

  it('ignores space around the text and between the handle and the body', () => {
    expect(parseAddress('  @fe   build the page  ', HANDLES)).toEqual({
      kind: 'request',
      to: 'fe',
      body: 'build the page',
    });
  });

  it('keeps a body that runs over several lines', () => {
    expect(parseAddress('@api\nadd the endpoint\n\nthen open a PR', HANDLES)).toEqual({
      kind: 'request',
      to: 'api',
      body: 'add the endpoint\n\nthen open a PR',
    });
  });

  it('accepts a colon or a comma after the handle', () => {
    expect(parseAddress('@api: add the endpoint', HANDLES)).toMatchObject({
      kind: 'request',
      to: 'api',
      body: 'add the endpoint',
    });
    expect(parseAddress('@api, add the endpoint', HANDLES)).toMatchObject({
      kind: 'request',
      to: 'api',
    });
  });

  it('matches a handle in any letter case and returns it in lower case', () => {
    expect(parseAddress('@API add the endpoint', HANDLES)).toMatchObject({
      kind: 'request',
      to: 'api',
    });
  });

  it('reads the whole handle, not a member handle it starts with', () => {
    expect(parseAddress('@api-v2 add the endpoint', HANDLES)).toMatchObject({ to: 'api-v2' });
    expect(parseAddress('@api-v3 add the endpoint', HANDLES)).toEqual({
      kind: 'note',
      body: '@api-v3 add the endpoint',
    });
    expect(parseAddress('@apis add the endpoint', HANDLES).kind).toBe('note');
  });

  it('treats an unknown handle as a note', () => {
    expect(parseAddress('@docs update the guide', HANDLES)).toEqual({
      kind: 'note',
      body: '@docs update the guide',
    });
    expect(parseAddress('@api add the endpoint', []).kind).toBe('note');
  });

  it('treats a handle in the middle of a sentence as a note', () => {
    expect(parseAddress('ask @api for the shape', HANDLES)).toEqual({
      kind: 'note',
      body: 'ask @api for the shape',
    });
    expect(parseAddress('cc @fe @api', HANDLES).kind).toBe('note');
  });

  it('addresses only the first handle and leaves later ones in the body', () => {
    expect(parseAddress('@fe ask @api for the shape', HANDLES)).toEqual({
      kind: 'request',
      to: 'fe',
      body: 'ask @api for the shape',
    });
  });

  it('treats a handle with nothing after it as a note', () => {
    expect(parseAddress('@api', HANDLES)).toEqual({ kind: 'note', body: '@api' });
    expect(parseAddress('@api   ', HANDLES)).toEqual({ kind: 'note', body: '@api' });
    expect(parseAddress('@api:', HANDLES)).toEqual({ kind: 'note', body: '@api:' });
    expect(parseAddress('@all', HANDLES)).toEqual({ kind: 'note', body: '@all' });
  });

  it('treats a handle joined to other characters as a note', () => {
    for (const text of [
      "@api's endpoint is slow",
      '@api.orders is slow',
      '@api/fe sync',
      '@ api hi',
    ]) {
      expect(parseAddress(text, HANDLES)).toEqual({ kind: 'note', body: text });
    }
  });

  it('reads a leading @all as addressed to everyone', () => {
    expect(parseAddress('@all rebase on main', HANDLES)).toEqual({
      kind: 'all',
      body: 'rebase on main',
    });
    expect(parseAddress('@All rebase on main', [])).toEqual({
      kind: 'all',
      body: 'rebase on main',
    });
    expect(parseAddress('tell @all to rebase', HANDLES).kind).toBe('note');
  });

  it('treats plain and empty text as a note', () => {
    expect(parseAddress('The orders response is now paged.', HANDLES)).toEqual({
      kind: 'note',
      body: 'The orders response is now paged.',
    });
    expect(parseAddress('   ', HANDLES)).toEqual({ kind: 'note', body: '' });
    expect(parseAddress('someone@api.dev wrote in', HANDLES).kind).toBe('note');
  });
});
