import { describe, expect, it } from 'vitest';
import {
  chatSummaryPrompt,
  handbackNote,
  handoffPrompt,
  HANDOFF_HEADINGS,
  HISTORY_TOOL_NOTE,
  type HandoffContext,
} from './handoff.ts';

const base: HandoffContext = {
  kind: 'brief',
  request: 'Make totals in src/ledger.ts handle several currencies.',
  history: [
    { role: 'user', content: 'Keep amounts in integer cents.' },
    { role: 'assistant', content: 'Changed the parser to cents.' },
  ],
  agreedPlan: null,
  changes: [{ path: 'src/parse.ts', additions: 12, deletions: 3 }],
  patch: '--- a/src/parse.ts\n+++ b/src/parse.ts\n+const cents = 1;',
  openIssues: ['Review findings still open:\n- [bug] rounding drops a cent'],
  checkCommands: ['pnpm test'],
};

describe('the structured handoff', () => {
  it('carries goal, rules, decisions, files, diff, open issues and acceptance', () => {
    const text = handoffPrompt(base);
    expect(text.startsWith(HANDOFF_HEADINGS.brief)).toBe(true);
    for (const heading of [
      '## Goal',
      '## Rules',
      '## Decisions so far',
      '## Relevant files',
      '## Current diff',
      '## Open issues',
      '## Acceptance',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('User: Keep amounts in integer cents.');
    expect(text).toContain('- src/parse.ts (+12 -3)');
    expect(text).toContain('- src/ledger.ts (named in the request)');
    expect(text).toContain('+const cents = 1;');
    expect(text).toContain('[bug] rounding drops a cent');
    expect(text).toContain('`pnpm test` passes.');
  });

  it('keeps more recent turns verbatim when compacting', () => {
    const long = 'x'.repeat(3_000);
    const history = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${index} ${long}`,
    }));
    const brief = handoffPrompt({ ...base, history });
    const compact = handoffPrompt({ ...base, kind: 'compact', history });
    expect(compact).toContain(HANDOFF_HEADINGS.compact);
    expect(compact).toContain('## Recent turns, verbatim');
    expect(compact).toContain('turn 2 ');
    expect(brief).not.toContain('turn 7 ');
    expect(brief).toContain('[cut at 1500 characters]');
    expect(compact).not.toContain('[cut at');
  });

  it('tells the kept session what the stronger Builder did', () => {
    const note = handbackNote('Opus 5.5', base.history);
    expect(note).toContain('Opus 5.5 handled the last request in this task from a brief');
    expect(note).toContain('Changed the parser to cents.');
  });
});

describe('the compacted chat summary', () => {
  const chat = {
    history: Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: index % 2 === 0 ? `request ${index / 2}` : `reply ${(index - 1) / 2}`,
    })),
    agreedPlan: '## Agreed plan\n- Cents everywhere',
    changes: base.changes,
    patch: base.patch,
    openIssues: base.openIssues,
  };

  it('keeps the first request, every request, the plan, recent turns, diff and open issues', () => {
    const text = chatSummaryPrompt(chat);
    expect(text.startsWith(HANDOFF_HEADINGS.chat)).toBe(true);
    expect(text).toContain(HISTORY_TOOL_NOTE);
    expect(text).toContain('## What the chat started with\nrequest 0');
    expect(text).toContain('1. request 0');
    expect(text).toContain('20. request 19');
    expect(text).toContain('## Agreed plan\n- Cents everywhere');
    expect(text).toContain('## Recent turns, verbatim');
    expect(text).toContain('Assistant: reply 19');
    expect(text).not.toContain('User: request 2\n');
    expect(text).toContain('- src/parse.ts (+12 -3)');
    expect(text).toContain('+const cents = 1;');
    expect(text).toContain('[bug] rounding drops a cent');
    expect(text).not.toContain('## Acceptance');
    expect(text).not.toContain('## Rules');
  });

  it('lists only the latest requests of a very long chat and leaves out empty parts', () => {
    const history = Array.from({ length: 35 }, (_, index) => ({
      role: 'user' as const,
      content: `ask ${index}`,
    }));
    const text = chatSummaryPrompt({
      history,
      agreedPlan: null,
      changes: [],
      patch: '',
      openIssues: [],
    });
    expect(text).toContain('(5 earlier requests not listed)');
    expect(text).toContain('6. ask 5');
    expect(text).not.toContain('1. ask 0');
    expect(text).not.toContain('## Current diff');
    expect(text).not.toContain('## Open issues');
  });
});
