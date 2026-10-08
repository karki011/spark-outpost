import { describe, expect, it } from 'vitest';
import { flagNote } from './rail-flag-text.ts';

describe('what a flag card says under its title', () => {
  it('says a send off this computer cannot be reverted', () => {
    expect(flagNote({ rail: 'sent_out', inside: false, originals: [] })).toBe(
      "The agent did this without asking. Spark didn't stop the run. Spark can't revert this.",
    );
  });

  it('does not call a kept change to another piece’s file impossible to revert', () => {
    const note = flagNote({ rail: 'other_piece', inside: false, originals: [] });
    expect(note).not.toContain("can't revert");
    expect(note).toContain("The change was kept and the file's owner was told.");
  });

  it('adds nothing when the card offers Revert', () => {
    expect(flagNote({ rail: 'secret', inside: true, originals: [] })).toBe(
      "The agent did this without asking. Spark didn't stop the run.",
    );
  });
});
