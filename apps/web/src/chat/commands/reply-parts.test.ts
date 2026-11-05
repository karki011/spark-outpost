import { describe, expect, it } from 'vitest';
import type { BrowserShot } from '@spark-outpost/contracts';
import type { CommandView } from './command-model.ts';
import { turnParts } from './reply-parts.ts';

function command(id: string, textOffset: number | null, startedAt: string): CommandView {
  return {
    id,
    runId: 'run',
    command: `echo ${id}`,
    cwd: './',
    live: true,
    status: 'completed',
    exitCode: 0,
    startedAt,
    finishedAt: startedAt,
    outputChars: 0,
    textOffset,
    textBefore: null,
    textHeld: 0,
    output: '',
    received: 0,
    appended: 0,
    epoch: 0,
  };
}

function anchored(id: string, textOffset: number, textBefore: string, textHeld: number) {
  return { ...command(id, textOffset, '2026-01-01T00:00:01Z'), textBefore, textHeld };
}

function shot(id: string, textOffset: number, createdAt: string): BrowserShot {
  return { id, textOffset, textBefore: null, textHeld: 0, createdAt } as BrowserShot;
}

const kinds = (text: string, shots: BrowserShot[], commands: CommandView[]) =>
  turnParts(text, shots, commands).map((part) =>
    part.kind === 'text' ? part.text : part.kind === 'command' ? `<${part.command.id}>` : '<shots>',
  );

describe('turnParts', () => {
  it('puts each command where it ran in the reply', () => {
    const text = 'Running tests.\n\nNow linting.\n\nAll done.';
    const parts = kinds(
      text,
      [],
      [command('a', 16, '2026-01-01T00:00:01Z'), command('b', 30, '2026-01-01T00:00:02Z')],
    );
    expect(parts).toEqual(['Running tests.\n\n', '<a>', 'Now linting.\n\n', '<b>', 'All done.']);
  });

  it('keeps commands that ran back to back in the order they started', () => {
    const parts = kinds(
      'Start.',
      [],
      [command('b', 6, '2026-01-01T00:00:02Z'), command('a', 6, '2026-01-01T00:00:01Z')],
    );
    expect(parts).toEqual(['Start.', '<a>', '<b>']);
  });

  it('shows a command before any text when it ran first', () => {
    expect(kinds('After.', [], [command('a', 0, '2026-01-01T00:00:01Z')])).toEqual([
      '<a>',
      'After.',
    ]);
  });

  it('puts a command at the end when its place is not known or not written yet', () => {
    expect(kinds('Text.', [], [command('a', null, '2026-01-01T00:00:01Z')])).toEqual([
      'Text.',
      '<a>',
    ]);
    expect(kinds('Te', [], [command('a', 40, '2026-01-01T00:00:01Z')])).toEqual(['Te', '<a>']);
  });

  it('never splits a code block', () => {
    const text = 'Look:\n```sh\nnpm test\n```\nDone.';
    expect(kinds(text, [], [command('a', 14, '2026-01-01T00:00:01Z')])).toEqual([
      'Look:\n```sh\nnpm test\n```',
      '<a>',
      '\nDone.',
    ]);
  });

  it('orders screenshots and commands together', () => {
    const text = 'One. Two. Three.';
    const parts = kinds(
      text,
      [shot('s', 10, '2026-01-01T00:00:03Z')],
      [command('a', 5, '2026-01-01T00:00:01Z'), command('b', 10, '2026-01-01T00:00:02Z')],
    );
    expect(parts).toEqual(['One. ', '<a>', 'Two. ', '<b>', '<shots>', 'Three.']);
  });

  describe("in the publish result, where Spark's line leads the agent's reply", () => {
    const led = [
      'Opened pull request #353: https://github.com/acme/app/pull/353',
      "The change is on spark/session-activity in this chat's worktree.",
      'There was nothing new to publish.',
    ].join('\n\n');

    it.each([
      ['held back its first letter', anchored('a', 1, '', 1)],
      ['had only a line break', anchored('a', 1, '\n', 0)],
    ])('never splits a word when the agent %s before the command', (_, ran) => {
      const parts = kinds(led, [], [ran]);
      expect(parts[0]).toBe('<a>');
      expect(parts.slice(1).join('')).toBe(led);
    });
  });
});
