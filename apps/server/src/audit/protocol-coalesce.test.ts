import { describe, expect, it } from 'vitest';
import { createProtocolRecorder } from './protocol-entry.ts';

const commands = (names: string[]) => ({
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId: 's1',
    update: {
      sessionUpdate: 'available_commands_update',
      availableCommands: names.map((name) => ({ name, description: `${name} does a thing` })),
    },
  },
});

describe('repeated command lists', () => {
  it('keeps the first copy and stores later identical copies as a short marker', () => {
    const recorder = createProtocolRecorder();
    const first = recorder.entry('from_agent', commands(['review', 'init']));
    const second = recorder.entry('from_agent', commands(['review', 'init']));
    expect(JSON.stringify(first.payload)).toContain('review does a thing');
    expect(second.payload).toEqual({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: {
          sessionUpdate: 'available_commands_update',
          repeatsPrevious: true,
          commandCount: 2,
        },
      },
    });
    expect(second.sizeBytes).toBe(first.sizeBytes);
    expect(second.method).toBe('session/update');
  });

  it('stores a changed list in full again', () => {
    const recorder = createProtocolRecorder();
    recorder.entry('from_agent', commands(['review']));
    const changed = recorder.entry('from_agent', commands(['review', 'compact']));
    expect(JSON.stringify(changed.payload)).toContain('compact does a thing');
  });
});

describe('account email', () => {
  it('is removed from sign-in status records', () => {
    const entry = createProtocolRecorder().entry('from_agent', {
      jsonrpc: '2.0',
      method: '_auth/status_update',
      params: {
        authStatus: {
          kind: 'account',
          label: 'Claude Max (pat@example.com)',
          account: { plan: 'max', email: 'pat@example.com', emailAddress: 'pat@example.com' },
        },
      },
    });
    const stored = JSON.stringify(entry.payload);
    expect(stored).not.toContain('pat@example.com');
    expect(stored).toContain('[redacted:account_email]');
    expect(stored).toContain('"plan":"max"');
  });

  it('is left alone in other messages', () => {
    const entry = createProtocolRecorder().entry('to_agent', {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/prompt',
      params: { prompt: [{ type: 'text', text: 'Write to pat@example.com' }] },
    });
    expect(JSON.stringify(entry.payload)).toContain('pat@example.com');
  });
});
