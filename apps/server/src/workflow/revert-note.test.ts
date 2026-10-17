import { describe, expect, it } from 'vitest';
import { withAgentNote } from './agent-note.ts';
import { revertNote } from './revert-note.ts';
import type { RunInput } from './run-input.ts';

describe('the note about reverted files', () => {
  it('groups paths by the run they were reverted from', () => {
    expect(
      revertNote([
        { runNumber: 1, path: 'a.ts' },
        { runNumber: 1, path: 'b.ts' },
        { runNumber: 3, path: 'c.ts' },
      ]),
    ).toBe(
      'The user reverted these files to how they were before run 1: a.ts, b.ts.\n' +
        'The user reverted these files to how they were before run 3: c.ts.\n' +
        'Re-read them before editing.',
    );
  });

  it('goes before the message, after any earlier note, and never before a slash command', () => {
    const input = { prompt: 'Fix it', followUp: 'Compacted.\n\nFix it' } as RunInput;
    expect(withAgentNote(input, 'Reverted.').followUp).toBe('Reverted.\n\nCompacted.\n\nFix it');
    const command = { prompt: ' /compact' } as RunInput;
    expect(withAgentNote(command, 'Reverted.')).toBe(command);
  });
});
