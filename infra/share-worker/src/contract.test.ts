import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_TITLE_MAX,
} from '../../../packages/contracts/src/artifact-pages.ts';
import {
  ARTIFACT_SHARE_DAYS,
  ARTIFACT_SHARE_DELETE_TOKEN_PATTERN,
  ARTIFACT_SHARE_ID_PATTERN,
  ARTIFACT_SHARE_PASSCODE_ALPHABET,
  ARTIFACT_SHARE_PASSCODE_LENGTH,
  ARTIFACT_SHARE_THEME_COLORS,
  ARTIFACT_SHARE_THEME_COLOR_PATTERN,
  artifactShareThemeSchema,
} from '../../../packages/contracts/src/artifact-shares.ts';
import { shareIdForToken } from '../../../apps/server/src/artifacts/share-id.ts';
import { DELETE_TOKEN, EXPIRY_DAYS, MAX_HTML_BYTES, MAX_TITLE_CHARS, SHARE_ID } from './api.ts';
import { PASSCODE_ALPHABET, PASSCODE_LENGTH, randomToken, shareIdFor } from './crypto.ts';
import { THEME_COLOR, THEME_COLORS, THEME_SCHEMES } from './theme.ts';

describe('the worker and the app agree on the share contract', () => {
  it('uses the same id and delete token shapes', () => {
    expect(SHARE_ID.source).toBe(ARTIFACT_SHARE_ID_PATTERN.source);
    expect(DELETE_TOKEN.source).toBe(ARTIFACT_SHARE_DELETE_TOKEN_PATTERN.source);
  });

  it('gives the same id for the same delete token', async () => {
    const token = 'Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4';
    expect(await shareIdFor(token)).toBe('D65s4UWzkH75nfvCxUTMnw');
    expect(shareIdForToken(token)).toBe('D65s4UWzkH75nfvCxUTMnw');
    for (let index = 0; index < 20; index++) {
      const random = randomToken(32);
      const id = await shareIdFor(random);
      expect(shareIdForToken(random)).toBe(id);
      expect(id).toMatch(SHARE_ID);
    }
  });

  it('uses the same passcode alphabet and length', () => {
    expect(PASSCODE_ALPHABET).toBe(ARTIFACT_SHARE_PASSCODE_ALPHABET);
    expect(PASSCODE_LENGTH).toBe(ARTIFACT_SHARE_PASSCODE_LENGTH);
  });

  it('offers the same expiry choices', () => {
    expect(EXPIRY_DAYS).toEqual([...ARTIFACT_SHARE_DAYS]);
  });

  it('has the same page size and title limits', () => {
    expect(MAX_HTML_BYTES).toBe(ARTIFACT_MAX_BYTES);
    expect(MAX_TITLE_CHARS).toBe(ARTIFACT_TITLE_MAX);
  });

  it('accepts the same theme colours', () => {
    expect([...THEME_COLORS]).toEqual([...ARTIFACT_SHARE_THEME_COLORS]);
    expect(THEME_COLOR.source).toBe(ARTIFACT_SHARE_THEME_COLOR_PATTERN.source);
    expect(['scheme', ...THEME_COLORS].sort()).toEqual(
      Object.keys(artifactShareThemeSchema.shape).sort(),
    );
    expect([...THEME_SCHEMES]).toEqual(artifactShareThemeSchema.shape.scheme.options);
  });
});
