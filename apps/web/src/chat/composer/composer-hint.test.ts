import { describe, expect, it } from 'vitest';
import type { AttachmentsState } from '../attachments/use-attachments.ts';
import { composerHint } from './composer-hint.ts';

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

  it('keeps the file and idle hints', () => {
    expect(composerHint(files({ uploading: true }), true, 'queue')).toBe('Uploading your files…');
    expect(composerHint(files(), false, 'queue')).toBe(
      'Enter to send, Shift + Enter for a new line',
    );
  });
});
