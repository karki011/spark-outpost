import { describe, expect, it } from 'vitest';
import { sparkChatMeans, sparkJobMeans } from './spark-means.ts';

const claude = (mode: string | null, level: 'hands-off' | 'full-auto' | null) =>
  sparkChatMeans({ name: 'Pip', provider: 'claude', mode, level });

describe('sparkChatMeans', () => {
  it('says a read-only Spark reads and reports, whatever its autonomy', () => {
    expect(claude('plan', 'full-auto')).toBe('Pip reads and reports. It changes no files.');
    expect(sparkChatMeans({ name: 'Pip', provider: 'codex', mode: 'read-only', level: null })).toBe(
      'Pip reads and reports. It changes no files.',
    );
  });

  it('says whether a Spark that changes files asks first', () => {
    expect(claude('default', 'hands-off')).toBe(
      'Pip changes files, asking before each edit and command. It keeps its changes and opens no pull request unless you ask.',
    );
    expect(claude('acceptEdits', 'hands-off')).toContain(
      'changes files without asking and asks before it runs a command',
    );
    expect(claude('bypassPermissions', 'hands-off')).toContain(
      'changes files and runs commands without asking',
    );
  });

  it('adds the pull request at Full auto', () => {
    expect(claude('auto', 'full-auto')).toBe(
      'Pip changes files without asking and decides itself when to ask, and opens its own pull request.',
    );
  });

  it('points at Settings when the autonomy is the default', () => {
    expect(claude('auto', null)).toBe(
      'Pip changes files without asking and decides itself when to ask. Whether it opens a pull request follows Settings → Chats & autonomy.',
    );
  });

  it('follows the chat when the Spark names no mode', () => {
    expect(sparkChatMeans({ name: 'Pip', provider: null, mode: null, level: 'full-auto' })).toBe(
      'Pip follows the mode of the chat it works in. It opens its own pull request.',
    );
  });

  it('uses a mode kind the provider reports for an id it does not know', () => {
    expect(
      sparkChatMeans({
        name: 'Pip',
        provider: 'other',
        mode: 'careful',
        kind: 'read_only',
        level: null,
      }),
    ).toBe('Pip reads and reports. It changes no files.');
    expect(
      sparkChatMeans({ name: 'Pip', provider: 'other', mode: 'careful', level: 'hands-off' }),
    ).toContain('a mode Spark does not know');
  });

  it('never leaves the name empty', () => {
    expect(sparkChatMeans({ name: ' ', provider: 'claude', mode: 'plan', level: null })).toBe(
      'This Spark reads and reports. It changes no files.',
    );
  });
});

describe('sparkJobMeans', () => {
  it('says a handed job only reads', () => {
    expect(sparkJobMeans('Pip')).toBe(
      'Handed one job with @Pip or as a workflow step, it reads and reports.',
    );
  });
});
