import { describe, expect, it } from 'vitest';
import type { ActionFacts } from '../../actions/action-policy.ts';
import { explicitlyAsked } from '../../actions/action-policy.ts';
import { externalReadPath } from './gate.ts';
import { takesImageResults } from './screenshot.ts';

const facts = (change: Partial<ActionFacts>): ActionFacts => ({
  posture: 'asks',
  requested: false,
  ...change,
});

describe('reading a page on an external site the user opened', () => {
  it('asks in Manual, Plan and read-only modes', () => {
    expect(externalReadPath(facts({ posture: 'asks' }))).toBe('ask');
    expect(externalReadPath(facts({ posture: 'read_only' }))).toBe('ask');
    expect(externalReadPath(facts({ posture: 'unknown' }))).toBe('ask');
  });

  it('reads without a card in Auto and Bypass', () => {
    expect(externalReadPath(facts({ posture: 'auto' }))).toBe('read');
    expect(externalReadPath(facts({ posture: 'full_access' }))).toBe('read');
  });

  it('reads in Accept edits only when the user asked for it', () => {
    expect(externalReadPath(facts({ posture: 'edits' }))).toBe('ask');
    expect(externalReadPath(facts({ posture: 'edits', requested: true }))).toBe('read');
    expect(explicitlyAsked('read_page', 'Can you check the page I have open?')).toBe(true);
    expect(explicitlyAsked('read_page', 'Refactor the parser')).toBe(false);
  });
});

describe('which models take a screenshot as an image', () => {
  it('sends images to Claude, Codex and the GLM model that reads them', () => {
    expect(takesImageResults('claude', 'opus')).toBe(true);
    expect(takesImageResults('codex', null)).toBe(true);
    expect(takesImageResults('zai', 'haiku')).toBe(true);
    expect(takesImageResults('zai', 'glm-5.3-flash')).toBe(true);
  });

  it('falls back to a file for text-only models and unknown providers', () => {
    expect(takesImageResults('zai', 'opus')).toBe(false);
    expect(takesImageResults('zai', null)).toBe(false);
    expect(takesImageResults(null, null)).toBe(false);
    expect(takesImageResults('fake', 'x')).toBe(false);
  });
});
