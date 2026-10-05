import { describe, expect, it } from 'vitest';
import {
  availabilityOf,
  emptyAccess,
  mergeReport,
  selectable,
  selectableDefault,
  withAccount,
  type StoredAccess,
} from './access.ts';

const NOW = new Date('2026-10-05T12:00:00Z');
const CHATGPT = { kind: 'account' as const, label: 'ChatGPT Plus', plan: 'plus' };
const REJECTED = { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', at: NOW.toISOString() };

const reported: StoredAccess = {
  method: 'cli',
  account: CHATGPT,
  listed: ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'],
  unlisted: ['gpt-7-preview'],
  rejected: [REJECTED],
  reportedAt: NOW,
};

describe('model availability for a connection', () => {
  it('rates listed models usable, unlisted ones unknown and rejected ones unusable', () => {
    expect(availabilityOf(reported, 'gpt-6-sol')).toBe('usable');
    expect(availabilityOf(reported, 'gpt-7-preview')).toBe('unknown');
    expect(availabilityOf(reported, 'gpt-6.1-sol')).toBe('unusable');
    expect(availabilityOf(reported, 'never-seen')).toBe('unknown');
  });

  it('assumes nothing when the provider reports no list', () => {
    expect(availabilityOf(null, 'glm-5.3')).toBe('unknown');
    expect(availabilityOf(emptyAccess('api_key'), 'glm-5.3')).toBe('unknown');
    const learned = { ...emptyAccess('api_key'), rejected: [REJECTED] };
    expect(availabilityOf(learned, 'gpt-6.1-sol')).toBe('unusable');
  });

  it('offers confirmed models first and unknown ones only when nothing is confirmed', () => {
    const models = [{ id: 'gpt-7-preview' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-sol' }];
    expect(selectable(models, reported)).toEqual([{ id: 'gpt-6-sol' }]);
    expect(selectable(models, null)).toEqual(models);
    const unreported = { ...emptyAccess('api_key'), rejected: [REJECTED] };
    expect(selectable(models, unreported)).toEqual([{ id: 'gpt-7-preview' }, { id: 'gpt-6-sol' }]);
  });

  it('moves the agent default only when access dropped it', () => {
    const all = [{ id: 'a' }, { id: 'b' }];
    expect(selectableDefault(all, [{ id: 'b' }], 'a')).toBe('b');
    expect(selectableDefault(all, all, 'a')).toBe('a');
    expect(selectableDefault(all, all, 'default')).toBe('default');
  });
});

describe('what a new report keeps', () => {
  const report = { account: CHATGPT, listed: ['gpt-6-sol'], unlisted: [] };

  it('keeps learned rejections for the same sign-in and refreshes the list and time', () => {
    const later = new Date('2026-10-06T00:00:00Z');
    const merged = mergeReport(reported, 'cli', report, true, later);
    expect(merged.rejected).toEqual([REJECTED]);
    expect(merged.listed).toEqual(['gpt-6-sol']);
    expect(merged.reportedAt).toEqual(later);
  });

  it('forgets rejections when the method, account kind or plan changes', () => {
    expect(mergeReport(reported, 'api_key', report, true, NOW).rejected).toEqual([]);
    const key = { kind: 'api_key' as const, label: 'OpenAI API key', plan: null };
    expect(withAccount(reported, 'cli', key).rejected).toEqual([]);
    const pro = { ...CHATGPT, label: 'ChatGPT Pro', plan: 'pro' };
    expect(withAccount(reported, 'cli', pro).rejected).toEqual([]);
  });

  it('keeps the known account when a report names none', () => {
    const merged = mergeReport(reported, 'cli', { ...report, account: null }, true, NOW);
    expect(merged.account).toEqual(CHATGPT);
    expect(merged.rejected).toEqual([REJECTED]);
  });

  it('records no list for a provider that does not report availability', () => {
    const merged = mergeReport(null, 'api_key', { ...report, account: null }, false, NOW);
    expect(merged).toMatchObject({ listed: [], reportedAt: null });
  });
});
