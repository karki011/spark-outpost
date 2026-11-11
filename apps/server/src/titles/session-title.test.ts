import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_NAME } from '../agents/acp/session-name.ts';
import { cleanSessionTitle, createSessionTitleWatch } from './session-title.ts';

describe('cleaning a title an agent session reports', () => {
  it('flattens whitespace, newlines and control characters', () => {
    expect(cleanSessionTitle('  Fix\n\n the\u0007 date\t divider  ', [])).toBe(
      'Fix the date divider',
    );
    expect(cleanSessionTitle('‮Fix​ it', [])).toBe('Fix it');
  });

  it('caps the length at the rename limit', () => {
    const title = cleanSessionTitle('word '.repeat(80), [])!;
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith('…')).toBe(true);
    expect(cleanSessionTitle('x'.repeat(100), [])).toBe('x'.repeat(100));
  });

  it('redacts secret values from the project and known secret shapes', () => {
    const value = 'correct-horse-battery-staple';
    expect(cleanSessionTitle(`Use ${value} for login`, [value])).not.toContain(value);
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    expect(cleanSessionTitle(`Rotate ${token}`, [])).not.toContain(token);
  });

  it('gives nothing for an empty title', () => {
    expect(cleanSessionTitle(' \n\u0007\t', [])).toBeNull();
  });
});

describe('watching a turn for the session title', () => {
  const title = (value: string) => ({ kind: 'session_title', title: value }) as const;

  it('keeps the last usable title', () => {
    const watch = createSessionTitleWatch([], 'Chat title');
    watch.see(title('First'));
    watch.see(title(' \n '));
    watch.see(title('Second'));
    watch.see({ kind: 'plan', entries: [] });
    expect(watch.latest()).toBe('Second');
  });

  it('ignores the name Spark gave the session', () => {
    const named = createSessionTitleWatch([], 'Fix the  date divider');
    named.see(title('Fix the date divider'));
    expect(named.latest()).toBeNull();
    const unnamed = createSessionTitleWatch([], undefined);
    unnamed.see(title(DEFAULT_SESSION_NAME));
    expect(unnamed.latest()).toBeNull();
  });
});
