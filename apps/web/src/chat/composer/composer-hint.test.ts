import { describe, expect, it } from 'vitest';
import type { AttachmentsState } from '../attachments/use-attachments.ts';
import { composerHint, composerPlaceholder } from './composer-hint.ts';

function files(state: Partial<AttachmentsState> = {}): AttachmentsState {
  return { items: [], uploading: false, failed: false, ...state } as AttachmentsState;
}

describe('composer hint', () => {
  it('names no keys while a turn runs, since the placeholder and send button carry them', () => {
    expect(composerHint(files(), true, 'queue')).toBe('');
    expect(composerHint(files(), true, 'now')).toBe('');
  });

  it('still says what Enter does while the agent only waits', () => {
    expect(composerHint(files(), true, 'now', 2)).toMatch(/^Enter to send to the agent now/);
  });

  it('keeps the file hints and leaves the keys to the send button when idle', () => {
    expect(composerHint(files({ uploading: true }), true, 'queue')).toBe('Uploading your files…');
    expect(composerHint(files({ failed: true }), false, 'queue')).toBe(
      'Remove or retry the files that failed',
    );
    expect(composerHint(files(), false, 'queue')).toBe('');
  });
});

describe('composer placeholder', () => {
  const idle = { queueing: false, preferred: 'queue' as const };

  it('names only what @ reaches in this chat', () => {
    expect(composerPlaceholder({ ...idle, hasRepos: true, hasSparks: false })).toBe(
      'Ask anything. @ for files, / for commands',
    );
    expect(composerPlaceholder({ ...idle, hasRepos: true, hasSparks: true })).toBe(
      'Ask anything. @ for files or a Spark, / for commands',
    );
    expect(composerPlaceholder({ ...idle, hasRepos: false, hasSparks: true })).toBe(
      'Ask anything. @ for a Spark, / for commands',
    );
    expect(composerPlaceholder({ ...idle, hasRepos: false, hasSparks: false })).toBe(
      'Ask anything. / for commands',
    );
  });

  it('says where a message goes while a turn runs', () => {
    expect(
      composerPlaceholder({ queueing: true, preferred: 'queue', hasRepos: true, hasSparks: true }),
    ).toBe('Queue a message for when this turn ends');
  });
});
