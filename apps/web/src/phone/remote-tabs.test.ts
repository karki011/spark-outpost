import { describe, expect, it } from 'vitest';
import { remoteTab } from './remote-tabs.ts';

describe('the tab the Remote control page shows', () => {
  it('starts on Set up until remote control is on, then on Devices', () => {
    expect(remoteTab(null, true)).toBe('setup');
    expect(remoteTab(null, false)).toBe('devices');
  });

  it('keeps the tab the user chose', () => {
    expect(remoteTab({ tab: 'permissions', setup: true }, true)).toBe('permissions');
    expect(remoteTab({ tab: 'others', setup: false }, false)).toBe('others');
    expect(remoteTab({ tab: 'setup', setup: false }, false)).toBe('setup');
  });

  it('moves on from Set up when set-up finishes, and back to it when remote control is turned off', () => {
    expect(remoteTab({ tab: 'setup', setup: true }, false)).toBe('devices');
    expect(remoteTab({ tab: 'setup', setup: false }, true)).toBe('setup');
  });

  it('stays on another tab when remote control turns on or off', () => {
    expect(remoteTab({ tab: 'permissions', setup: true }, false)).toBe('permissions');
    expect(remoteTab({ tab: 'devices', setup: false }, true)).toBe('devices');
  });
});
