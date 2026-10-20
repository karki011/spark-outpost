import { describe, expect, it } from 'vitest';
import { CLIENT_CAPABILITIES, turnCapabilities } from './client-info.ts';

function airCapabilities(capabilities: { _meta?: unknown }): unknown {
  const meta = capabilities._meta as { jetbrains?: { air?: { capabilities?: unknown } } };
  return meta.jetbrains?.air?.capabilities;
}

describe('client capabilities', () => {
  it('asks for background task updates on a turn, so a wait on them can be shown', () => {
    expect(airCapabilities(turnCapabilities(true, false))).toContain('asyncTasks');
  });

  it('keeps the capability probe to session failures', () => {
    expect(airCapabilities(CLIENT_CAPABILITIES)).toEqual(['sessionFailure']);
  });
});
