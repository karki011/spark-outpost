import { describe, expect, it } from 'vitest';
import type { TailscaleStatus } from '@spark-outpost/contracts';
import { setupSteps } from './setup-steps.ts';

function states(status: TailscaleStatus) {
  return setupSteps(status)?.map((step) => step.state);
}

describe('setup steps', () => {
  it('asks for Tailscale first when it is missing or signed out', () => {
    expect(states('not_installed')).toEqual(['needs_you', 'next', 'later']);
    expect(states('signed_out')).toEqual(['needs_you', 'next', 'later']);
  });

  it('asks for HTTPS certificates once Tailscale is connected', () => {
    expect(states('https_off')).toEqual(['done', 'needs_you', 'next']);
  });

  it('asks only for turning on when everything else is ready', () => {
    expect(states('off')).toEqual(['done', 'done', 'needs_you']);
  });

  it('has no setup once remote control is on or has failed', () => {
    expect(setupSteps('on')).toBeNull();
    expect(setupSteps('error')).toBeNull();
  });
});
