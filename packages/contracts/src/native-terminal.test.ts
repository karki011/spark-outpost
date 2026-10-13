import { describe, expect, it } from 'vitest';
import {
  terminalDependenciesText,
  terminalStartPhaseSchema,
  terminalStartSchema,
  terminalStartText,
} from './native-terminal.ts';

describe('what a starting Terminal session says it is doing', () => {
  it('names each phase in plain words and the agent by its own name', () => {
    expect(terminalStartText('fetch', 'Claude Code')).toBe('Fetching the latest from the remote…');
    expect(terminalStartText('worktree', 'Claude Code')).toBe('Creating this session’s worktree…');
    expect(terminalStartText('copy', 'Claude Code')).toBe('Copying dependencies…');
    expect(terminalStartText('install', 'Claude Code')).toBe('Installing dependencies…');
    expect(terminalStartText('agent', 'Claude Code')).toBe('Starting Claude Code…');
    expect(terminalStartText('agent', 'Codex')).toBe('Starting Codex…');
  });

  it('says Starting terminal before a phase is known', () => {
    expect(terminalStartText(null, 'Codex')).toBe('Starting terminal…');
    expect(terminalStartText('preparing', 'Codex')).toBe('Starting terminal…');
  });

  it('has a line for every phase the server can report, and none ends without an ellipsis', () => {
    for (const phase of terminalStartPhaseSchema.options)
      expect(terminalStartText(phase, 'Codex')).toMatch(/^[A-Z][^/]+…$/);
  });

  it('says which dependency step is still running, or the failure as it was worded', () => {
    const wait = 'Commands that need them may fail until this finishes.';
    expect(terminalDependenciesText({ state: 'preparing', step: null, note: null })).toBe(
      `Dependencies are still copying. ${wait}`,
    );
    expect(terminalDependenciesText({ state: 'preparing', step: 'copy', note: null })).toBe(
      `Dependencies are still copying. ${wait}`,
    );
    expect(terminalDependenciesText({ state: 'preparing', step: 'install', note: null })).toBe(
      `Dependencies are still installing. ${wait}`,
    );
    expect(
      terminalDependenciesText({ state: 'failed', step: null, note: 'Installing them failed.' }),
    ).toBe('Installing them failed.');
    expect(terminalDependenciesText({ state: 'failed', step: null, note: null })).toBe(
      'Dependencies could not be prepared in this session’s worktree.',
    );
  });

  it('accepts only known phases from the server', () => {
    expect(terminalStartSchema.parse({ phase: null })).toEqual({ phase: null });
    expect(terminalStartSchema.safeParse({ phase: '/Users/me/project' }).success).toBe(false);
  });
});
