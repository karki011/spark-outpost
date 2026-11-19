import { describe, expect, it } from 'vitest';
import { agentSourceWords, modeText } from './spark-settings-text.ts';

const modes = [
  { id: 'default', label: 'Manual', description: null, kind: null },
  { id: 'bypassPermissions', label: 'Bypass permissions', description: null, kind: null },
];

describe('the inherited agent and mode a step shows', () => {
  it('names the chat once when both came from it', () => {
    const spark = { agentMode: 'bypassPermissions', agentFrom: 'chat', modeFrom: 'chat' } as const;
    expect(modeText(spark, modes)).toBe('Bypass permissions (from chat)');
    expect(agentSourceWords(spark)).toBeNull();
  });

  it('names your default when the run had no chat', () => {
    const spark = { agentMode: 'default', agentFrom: 'default', modeFrom: 'default' } as const;
    expect(modeText(spark, modes)).toBe('Manual (your default)');
  });

  it('adds nothing to the Spark’s own settings, and marks only the inherited mode', () => {
    const own = { agentMode: 'default', agentFrom: 'spark', modeFrom: 'spark' } as const;
    expect(modeText(own, modes)).toBe('Manual');
    const mixed = { agentMode: 'bypassPermissions', agentFrom: 'spark', modeFrom: 'chat' } as const;
    expect(modeText(mixed, modes)).toBe('Bypass permissions (from chat)');
    expect(agentSourceWords(mixed)).toBeNull();
  });

  it('shows nothing for a run recorded before Spark kept these values', () => {
    expect(modeText({}, modes)).toBeNull();
    expect(modeText(undefined, modes)).toBeNull();
  });
});
