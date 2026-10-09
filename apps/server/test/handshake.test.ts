import { describe, expect, it } from 'vitest';
import { joinNotice } from '../src/outposts/handshake.ts';

describe('the line an outpost shows when a chat joins', () => {
  it('names only the chat when it is the first member', () => {
    expect(joinNotice('fe', ['fe'])).toBe('@fe joined.');
    expect(joinNotice('fe', [])).toBe('@fe joined.');
  });

  it('says the two chats can ask each other when the second joins', () => {
    expect(joinNotice('api', ['fe', 'api'])).toBe(
      '@api joined. @fe and @api can now ask each other.',
    );
  });

  it('lists every member, with the new chat last, when many are in the outpost', () => {
    expect(joinNotice('docs', ['fe', 'api', 'docs'])).toBe(
      '@docs joined. @fe, @api and @docs can now ask each other.',
    );
    expect(joinNotice('api', ['api', 'fe', 'docs'])).toBe(
      '@api joined. @fe, @docs and @api can now ask each other.',
    );
  });

  it('gives the same line whether or not the list already holds the new chat', () => {
    expect(joinNotice('api', ['fe'])).toBe(joinNotice('api', ['fe', 'api']));
  });
});
