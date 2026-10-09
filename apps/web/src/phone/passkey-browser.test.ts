import { describe, expect, it } from 'vitest';
import { base64UrlOf, bytesOf, saveProblemOf } from './passkey-browser.ts';

describe('passkey encoding', () => {
  it('reads unpadded base64url and writes it back', () => {
    const text = '-_-_AAECAwT_';
    expect([...bytesOf(text)]).toEqual([251, 255, 191, 0, 1, 2, 3, 4, 255]);
    expect(base64UrlOf(bytesOf(text).buffer)).toBe('-_-_AAECAwT_');
    expect(base64UrlOf(new Uint8Array([1]).buffer)).toBe('AQ');
    expect([...bytesOf('AQ')]).toEqual([1]);
  });
});

describe('why a passkey was not saved', () => {
  it('tells an existing passkey from a cancelled or failed prompt', () => {
    expect(saveProblemOf(new DOMException('exists', 'InvalidStateError'))).toBe('exists');
    expect(saveProblemOf(new DOMException('cancelled', 'NotAllowedError'))).toBe('not_saved');
    expect(saveProblemOf(new Error('boom'))).toBe('not_saved');
    expect(saveProblemOf('text')).toBe('not_saved');
  });
});
