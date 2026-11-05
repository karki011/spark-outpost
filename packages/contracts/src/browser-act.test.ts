import { describe, expect, it } from 'vitest';
import {
  BROWSER_ACT_LINE_MAX,
  browserActLine,
  browserActProblem,
  browserActSends,
} from './browser-act.ts';

const button = { role: 'button', name: '  Search\n the docs ', sensitive: false };

describe('what an agent asks the browser to do', () => {
  it('needs a ref to click or type, text to type and a key to press', () => {
    expect(browserActProblem({ action: 'click' })).toContain('ref');
    expect(browserActProblem({ action: 'type', text: 'x' })).toContain('ref');
    expect(browserActProblem({ action: 'type', ref: 'ref_2' })).toContain('text');
    expect(browserActProblem({ action: 'key' })).toContain('key');
  });

  it('takes the rest as they are', () => {
    expect(browserActProblem({ action: 'click', ref: 'ref_1' })).toBeNull();
    expect(browserActProblem({ action: 'type', ref: 'ref_2', text: '' })).toBeNull();
    expect(browserActProblem({ action: 'key', key: 'Enter' })).toBeNull();
    for (const action of ['scroll', 'back', 'forward', 'reload'] as const) {
      expect(browserActProblem({ action })).toBeNull();
    }
  });

  it('counts only typing as sending something to the site', () => {
    expect(browserActSends('type')).toBe(true);
    for (const action of ['click', 'key', 'scroll', 'back', 'forward', 'reload'] as const) {
      expect(browserActSends(action)).toBe(false);
    }
  });
});

describe('the line that says what the agent did', () => {
  it('names the element by role and name, never by what was typed', () => {
    expect(browserActLine({ action: 'click', target: button })).toBe(
      'Clicked button "Search the docs"',
    );
    expect(
      browserActLine({
        action: 'type',
        target: { role: 'textbox', name: 'Query', sensitive: false },
      }),
    ).toBe('Typed in textbox "Query"');
    expect(
      browserActLine({ action: 'click', target: { role: 'textbox', name: '', sensitive: true } }),
    ).toBe('Clicked textbox');
  });

  it('covers keys, scrolling and history', () => {
    expect(browserActLine({ action: 'key', target: null, key: 'Enter' })).toBe('Pressed Enter');
    expect(browserActLine({ action: 'key', target: button, key: 'Tab' })).toBe(
      'Pressed Tab in button "Search the docs"',
    );
    expect(browserActLine({ action: 'scroll', target: null, direction: 'up' })).toBe('Scrolled up');
    expect(browserActLine({ action: 'scroll', target: null })).toBe('Scrolled down');
    expect(browserActLine({ action: 'back', target: null })).toBe('Went back');
    expect(browserActLine({ action: 'forward', target: null })).toBe('Went forward');
    expect(browserActLine({ action: 'reload', target: null })).toBe('Reloaded the page');
  });

  it('stays short whatever the page calls the element', () => {
    const long = { role: 'link', name: 'x'.repeat(500), sensitive: false };
    expect(browserActLine({ action: 'click', target: long }).length).toBe(BROWSER_ACT_LINE_MAX);
  });
});
