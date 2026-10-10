import { describe, expect, it } from 'vitest';
import type { ProtocolDirection } from '@spark-outpost/contracts';
import type { AgentTerminalRow } from '../persistence/agent-terminals.ts';
import type { AuditMarks, ProtocolObserver } from '../providers/provider.ts';
import {
  TERMINAL_START_AUDIT,
  TERMINAL_STOP_AUDIT,
  auditTerminalStart,
  auditTerminalStop,
  type TerminalStartFacts,
} from './terminal-audit.ts';

interface Entry {
  direction: ProtocolDirection;
  message: { method: string; params: Record<string, unknown> };
  marks: AuditMarks | undefined;
}

function recording() {
  const entries: Entry[] = [];
  const audit: ProtocolObserver = {
    message: (direction, message, marks) =>
      void entries.push({ direction, message: message as Entry['message'], marks }),
    stderr: () => undefined,
  };
  return { audit, entries };
}

const facts = (change: Partial<TerminalStartFacts> = {}): TerminalStartFacts => ({
  command: 'pnpm dev',
  cwd: '/work/app',
  mode: 'bypassPermissions',
  decision: 'mode',
  reason: null,
  unreviewed: true,
  terminalId: 'terminal-1',
  approvalId: null,
  ...change,
});

describe('the audit entry for a Spark terminal start', () => {
  it('marks a start no card approved as ran without review', () => {
    const { audit, entries } = recording();
    auditTerminalStart(audit, facts());
    expect(entries).toEqual([
      {
        direction: 'harness',
        message: { method: TERMINAL_START_AUDIT, params: facts() },
        marks: { unreviewed: true },
      },
    ]);
  });

  it('does not mark a start the user allowed on a card', () => {
    const { audit, entries } = recording();
    auditTerminalStart(audit, facts({ decision: 'card', unreviewed: false, approvalId: 'card-1' }));
    expect(entries[0]?.marks).toBeUndefined();
    expect(entries[0]?.message.params).toMatchObject({ decision: 'card', approvalId: 'card-1' });
  });

  it('does not mark a refusal, whatever the mode', () => {
    const { audit, entries } = recording();
    auditTerminalStart(audit, facts({ decision: 'refused', reason: 'no', terminalId: null }));
    expect(entries[0]?.marks).toBeUndefined();
    expect(entries[0]?.message.params).toMatchObject({ unreviewed: false, terminalId: null });
  });

  it('redacts what looks like a secret in the facts', () => {
    const { audit, entries } = recording();
    auditTerminalStart(
      audit,
      facts({ reason: 'token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB' }),
    );
    expect(JSON.stringify(entries[0]?.message)).not.toContain('ghp_0123456789');
  });
});

describe('the audit entry for a Spark terminal stop', () => {
  it('names the terminal and who asked, never its output or command', () => {
    const { audit, entries } = recording();
    const row = { id: 'terminal-1', name: 'pnpm dev', command: 'pnpm dev' } as AgentTerminalRow;
    auditTerminalStop(audit, row, 'agent');
    expect(entries).toEqual([
      {
        direction: 'harness',
        message: {
          method: TERMINAL_STOP_AUDIT,
          params: { terminalId: 'terminal-1', name: 'pnpm dev', by: 'agent' },
        },
        marks: undefined,
      },
    ]);
  });
});
