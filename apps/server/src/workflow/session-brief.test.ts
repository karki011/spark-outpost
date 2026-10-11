import { describe, expect, it } from 'vitest';
import {
  CHAT_SUMMARY_HEADING,
  HISTORY_TOOL_NOTE,
  SESSION_HANDOFF_HEADING,
  chatSummaryPrompt,
  sessionHandoffPrompt,
} from './session-brief.ts';

const history = Array.from({ length: 10 }, (_, index) => ({
  role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
  content: `message ${index}`,
}));

describe('sessionHandoffPrompt', () => {
  const text = sessionHandoffPrompt({
    reason: "couldn't resume",
    goal: 'Add CSV export to Analytics',
    history,
    agreedPlan: '## Agreed plan\n1. Add the route\n2. Add the button',
    subtasks: ['P2 · API: running, check not run'],
    changes: [{ path: 'src/export.ts', additions: 40, deletions: 2 }],
    openIssues: ['Failing checks:\npnpm test: 1 failed'],
    totals: '4 turns, 9 runs, 120000 tokens, $1.84 so far.',
  });

  it('carries the goal, plan, open subtasks, files, last check output and chat totals', () => {
    expect(text.startsWith(SESSION_HANDOFF_HEADING)).toBe(true);
    expect(text).toContain("was replaced (couldn't resume)");
    expect(text).toContain(HISTORY_TOOL_NOTE);
    expect(text).toContain('## Goal\nAdd CSV export to Analytics');
    expect(text).toContain('## Agreed plan\n1. Add the route');
    expect(text).toContain('## Open subtasks\n- P2 · API: running, check not run');
    expect(text).toContain('## Files changed\n- src/export.ts (+40 -2)');
    expect(text).toContain('## Last check output\nFailing checks:\npnpm test: 1 failed');
    expect(text).toContain('## Chat totals\n4 turns, 9 runs');
  });

  it('keeps the last three exchanges verbatim and nothing older', () => {
    expect(text).toContain('User: message 4');
    expect(text).toContain('Assistant: message 9');
    expect(text).not.toContain('message 3');
  });

  it('says so when there is nothing to report', () => {
    const empty = sessionHandoffPrompt({
      reason: 'idle',
      goal: '',
      history: [],
      agreedPlan: null,
      subtasks: [],
      changes: [],
      openIssues: [],
      totals: null,
    });
    expect(empty).toContain('No request recorded.');
    expect(empty).toContain('## Files changed\nNone.');
    expect(empty).toContain('No failing checks or open review findings recorded.');
    expect(empty).toContain('No earlier messages.');
    expect(empty).not.toContain('## Open subtasks');
    expect(empty).not.toContain('## Chat totals');
  });
});

describe('the compacted chat summary', () => {
  const chat = {
    history: Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: index % 2 === 0 ? `request ${index / 2}` : `reply ${(index - 1) / 2}`,
    })),
    agreedPlan: '## Agreed plan\n- Cents everywhere',
    changes: [{ path: 'src/parse.ts', additions: 12, deletions: 3 }],
    patch: '--- a/src/parse.ts\n+++ b/src/parse.ts\n+const cents = 1;',
    openIssues: ['Review findings still open:\n- [bug] rounding drops a cent'],
  };

  it('keeps the first request, every request, the plan, recent turns, diff and open issues', () => {
    const text = chatSummaryPrompt(chat);
    expect(text.startsWith(CHAT_SUMMARY_HEADING)).toBe(true);
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
