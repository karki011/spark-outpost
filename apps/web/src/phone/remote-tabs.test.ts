import { describe, expect, it } from 'vitest';
import { afterSetupChange, remoteTab } from './remote-tabs.ts';

describe('the tab the Remote control page shows', () => {
  it('starts on Set up until remote control is on, then on Devices', () => {
    expect(remoteTab(null, true)).toBe('setup');
    expect(remoteTab(null, false)).toBe('devices');
  });

  it('keeps the tab the user chose', () => {
    expect(remoteTab('permissions', true)).toBe('permissions');
    expect(remoteTab('others', false)).toBe('others');
    expect(remoteTab('setup', false)).toBe('setup');
  });

  it('follows set-up each time it finishes or is undone, when the user was on Set up', () => {
    let chosen = afterSetupChange('setup');
    expect(remoteTab(chosen, true)).toBe('setup');
    chosen = afterSetupChange(chosen);
    expect(remoteTab(chosen, false)).toBe('devices');
    chosen = afterSetupChange('setup');
    expect(remoteTab(chosen, false)).toBe('devices');
  });

  it('stays on another tab when remote control turns on or off', () => {
    expect(afterSetupChange('permissions')).toBe('permissions');
    expect(afterSetupChange('devices')).toBe('devices');
    expect(afterSetupChange(null)).toBeNull();
  });
});
