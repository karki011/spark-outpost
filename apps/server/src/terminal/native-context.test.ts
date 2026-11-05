import { describe, expect, it } from 'vitest';
import { boundedNativeMode, observedNativeMode } from './native-context.ts';

describe('native terminal permission observations', () => {
  it('never lets a hook widen the user-selected permission mode', () => {
    expect(boundedNativeMode('claude', 'plan', 'bypassPermissions')).toBe('plan');
    expect(boundedNativeMode('claude', 'default', 'bypassPermissions')).toBe('default');
    expect(boundedNativeMode('claude', 'acceptEdits', 'auto')).toBe('acceptEdits');
    expect(boundedNativeMode('codex', 'read-only', 'agent-full-access')).toBe('read-only');
    expect(boundedNativeMode('codex', 'agent', 'agent-full-access')).toBe('agent');
  });

  it('lets native observations restrict permission and keeps missing observations conservative', () => {
    expect(boundedNativeMode('claude', 'bypassPermissions', 'plan')).toBe('plan');
    expect(boundedNativeMode('claude', 'auto', 'default')).toBe('default');
    expect(boundedNativeMode('codex', 'agent', null)).toBeNull();
    expect(observedNativeMode('claude', { kind: 'prompt', permissionMode: 'manual' })).toBe(
      'default',
    );
    expect(observedNativeMode('codex', { kind: 'prompt', permissionMode: 'default' })).toBe(
      'ask-every-action',
    );
  });
});
