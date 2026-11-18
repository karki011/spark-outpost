import { describe, expect, it } from 'vitest';
import {
  SCOUT_ANTENNA as APP_ANTENNA,
  SCOUT_BODY as APP_BODY,
  SCOUT_SPARK as APP_SPARK,
} from '../../../packages/contracts/src/scout-shape.ts';
import { lockedOutPage, unlockPage, verifiedPage, wrongCodePage } from './lock-pages.ts';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout.ts';
import type { ShareTheme } from './theme.ts';

const THEME: ShareTheme = {
  scheme: 'dark',
  bg: '#000000',
  card: '#07070a',
  text: '#eceaf6',
  muted: '#a2a0b9',
  line: '#62626d',
  accent: '#9d8aff',
  accentInk: '#130c33',
  ok: '#6fdca0',
  bad: '#ff6b8a',
  strip: '#121218',
};

const PAGES = {
  asleep: unlockPage('abc', THEME),
  no: wrongCodePage('abc', THEME),
  sulk: lockedOutPage('abc', 15, THEME),
  happy: verifiedPage('abc', 'ABCD2345', 2, THEME),
};

const INPUT =
  '<input id="code" name="code" type="text" maxlength="12" pattern="[\\s\\-]*([A-Za-z0-9][\\s\\-]*){8}" title="8 letters and numbers" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder=" " required';

function count(html: string, part: string): number {
  return html.split(part).length - 1;
}

function body(html: string): string {
  return html.slice(html.indexOf('<body'));
}

describe('lock pages', () => {
  it.each(Object.entries(PAGES))('draws Scout once, hidden, in the %s pose', (pose, html) => {
    expect(count(html, '<div class="scout"')).toBe(1);
    expect(html).toContain(`<div class="scout" data-pose="${pose}" aria-hidden="true">`);
    expect(count(html, `d="${APP_BODY}"`)).toBe(1);
    expect(html).not.toContain('<script');
  });

  it('draws the same Scout as the app', () => {
    expect([SCOUT_ANTENNA, SCOUT_SPARK, SCOUT_BODY]).toEqual([APP_ANTENNA, APP_SPARK, APP_BODY]);
  });

  it('keeps one real passcode field with its attributes on every entry page', () => {
    for (const html of [PAGES.asleep, PAGES.no, PAGES.sulk]) {
      expect(count(html, '<input')).toBe(1);
      expect(html).toContain(INPUT);
      expect(html).toContain('<form method="post" action="/a/abc/unlock">');
      expect(html).toContain(
        '<label class="hint" for="code">Passcode, 8 letters and numbers</label>',
      );
      expect(html).toContain('<button type="submit">Unlock</button>');
    }
    expect(PAGES.asleep).not.toContain('aria-invalid');
    expect(PAGES.no).toContain(' required aria-invalid="true" aria-describedby="code-error">');
  });

  it('wakes Scout from the field without a script and hides the caret on a full code', () => {
    expect(PAGES.asleep).toContain(".lock:has(#code:focus) .scout:not([data-pose='sulk'])");
    expect(PAGES.asleep).toContain(
      ".lock:has(#code:not(:placeholder-shown)) .scout:not([data-pose='sulk'])",
    );
    expect(PAGES.asleep).toContain('.field input:valid { caret-color: transparent; }');
  });

  it('says what went wrong in text and marks the boxes on the wrong code and locked out pages', () => {
    expect(body(PAGES.no)).toContain('<div class="field bad shake">');
    expect(body(PAGES.no)).toContain('<span>That code didn’t work. Check it and try again.</span>');
    expect(body(PAGES.sulk)).toContain('<div class="field bad">');
    expect(body(PAGES.sulk)).toContain(
      '<span>Too many wrong codes. Try again in about 15 minutes.</span>',
    );
    expect(lockedOutPage('abc', 1, null)).toContain('Try again in about 1 minute.');
    expect(body(PAGES.asleep)).toContain('<div class="field">');
  });

  it('opens the lock on the verified page and keeps the link hidden for 4 seconds', () => {
    const html = PAGES.happy;
    expect(count(body(html), 'class="tag-open"')).toBe(1);
    expect(body(PAGES.asleep)).not.toContain('class="tag-open"');
    expect(html).toContain('<meta http-equiv="refresh" content="2;url=/a/abc">');
    expect(html).toContain('visibility: hidden; animation: reveal 0s 4s forwards;');
    expect(html).toContain('<p class="open"><a href="/a/abc">Open the page</a></p>');
    expect(html).toMatch(/<div role="status">[\s\S]*Verified\.[\s\S]*You’re in\.[\s\S]*?<\/div>/);
    expect(count(html, '<input')).toBe(0);
  });

  it('stops every Scout animation for reduced motion', () => {
    for (const html of Object.values(PAGES)) {
      expect(html).toMatch(
        /@media \(prefers-reduced-motion: reduce\) \{\s*\.scout, \.scout \* \{ animation: none !important; transition: none !important; \}/,
      );
    }
  });

  it('colours every page from the share theme and falls back without one', () => {
    for (const html of Object.values(PAGES)) {
      expect(html).toContain('color-scheme: dark;');
      expect(html).toContain('--accent: #9d8aff;');
      expect(html).toContain('--accent-ink: #130c33;');
    }
    const plain = unlockPage('abc', null);
    expect(plain).not.toContain('--accent-ink:');
    expect(plain).toContain('--face: var(--accent-ink, var(--card));');
    for (const html of [plain, ...Object.values(PAGES)]) {
      expect(body(html)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });
});
