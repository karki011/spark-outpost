import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_TITLE_MAX,
} from '../../../packages/contracts/src/artifact-pages.ts';
import {
  ARTIFACT_SHARE_DAYS,
  ARTIFACT_SHARE_PASSCODE_ALPHABET,
  ARTIFACT_SHARE_PASSCODE_LENGTH,
  ARTIFACT_SHARE_THEME_COLORS,
  ARTIFACT_SHARE_THEME_COLOR_PATTERN,
  artifactShareThemeSchema,
} from '../../../packages/contracts/src/artifact-shares.ts';
import { EXPIRY_DAYS, MAX_HTML_BYTES, MAX_TITLE_CHARS } from './api.ts';
import { PASSCODE_ALPHABET, PASSCODE_LENGTH } from './crypto.ts';
import { THEME_COLOR, THEME_COLORS, THEME_SCHEMES } from './theme.ts';

describe('the worker and the app agree on the share contract', () => {
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
