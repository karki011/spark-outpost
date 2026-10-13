import { describe, expect, it } from 'vitest';
import { modePosture } from '@spark-outpost/contracts';
import type { ActionFacts } from '../../actions/action-policy.ts';
import { explicitlyAsked } from '../../actions/action-policy.ts';
import { sitePath } from './gate.ts';
import { takesImageResults } from './screenshot.ts';

const facts = (change: Partial<ActionFacts>): ActionFacts => ({
  posture: 'asks',
  requested: false,
  ...change,
});

describe('a browser tool that reaches a site outside this computer', () => {
  it('asks in Manual, Plan and read-only modes', () => {
    expect(sitePath(facts({ posture: 'asks' }))).toBe('ask');
    expect(sitePath(facts({ posture: 'read_only' }))).toBe('ask');
    expect(sitePath(facts({ posture: 'denies' }))).toBe('ask');
    expect(sitePath(facts({ posture: 'unknown' }))).toBe('ask');
  });

  it('runs without a card in Auto, Approve for me, Bypass and Full access', () => {
    expect(sitePath(facts({ posture: 'auto' }))).toBe('run');
    expect(sitePath(facts({ posture: 'full_access' }))).toBe('run');
  });

  it('runs in Accept edits only when the user asked for it', () => {
    expect(sitePath(facts({ posture: 'edits' }))).toBe('ask');
    expect(sitePath(facts({ posture: 'edits', requested: true }))).toBe('run');
  });

  it('asks in every mode on a tab the user owns', () => {
    for (const posture of ['asks', 'edits', 'auto', 'full_access'] as const) {
      expect(sitePath(facts({ posture, requested: true }), { userTab: true })).toBe('ask');
    }
  });

  it('asks in every mode when the text holds a value from a secret file', () => {
    for (const posture of ['asks', 'edits', 'auto', 'full_access'] as const) {
      expect(sitePath(facts({ posture, requested: true }), { secretFiles: ['.env'] })).toBe('ask');
    }
    expect(sitePath(facts({ posture: 'auto' }), { secretFiles: [] })).toBe('run');
  });

  it.each([
    ['codex', 'read-only', 'ask'],
    ['codex', 'ask-every-action', 'ask'],
    ['codex', 'agent', 'run'],
    ['codex', 'agent-full-access', 'run'],
    ['claude', 'default', 'ask'],
    ['claude', 'acceptEdits', 'ask'],
    ['claude', 'plan', 'ask'],
    ['claude', 'auto', 'run'],
    ['claude', 'bypassPermissions', 'run'],
  ])('%s %s: %s', (provider, mode, path) => {
    expect(sitePath(facts({ posture: modePosture(provider, mode) }))).toBe(path);
  });

  it('knows when the user asked to read, open or act', () => {
    expect(explicitlyAsked('read_page', 'Can you check the page I have open?')).toBe(true);
    expect(explicitlyAsked('read_page', 'Refactor the parser')).toBe(false);
    expect(explicitlyAsked('open_page', 'Look up the Stripe docs online')).toBe(true);
    expect(explicitlyAsked('open_page', 'Open https://example.com and find the price')).toBe(false);
    expect(explicitlyAsked('open_page', 'Open the pricing page on example.com')).toBe(true);
    expect(explicitlyAsked('open_page', 'Rename the variable')).toBe(false);
    expect(explicitlyAsked('act_page', 'Search the site for refunds')).toBe(true);
    expect(explicitlyAsked('act_page', 'Fill in the form and submit it')).toBe(true);
    expect(explicitlyAsked('act_page', 'Fix the failing test')).toBe(false);
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
