import { describe, expect, it } from 'vitest';
import {
  REMOTE_SWITCH_DEFAULTS,
  REMOTE_SWITCH_GROUPS,
  REMOTE_SWITCH_LABELS,
  type RemoteSwitch,
} from '@spark-outpost/contracts';
import { groupCount, labelsByState, SHOWN_SWITCHES, shownGroups } from './switch-groups.ts';

const ALL = Object.keys(REMOTE_SWITCH_LABELS) as RemoteSwitch[];

describe('switch groups', () => {
  it('puts every switch in exactly one group', () => {
    const grouped = REMOTE_SWITCH_GROUPS.flatMap((group) => group.switches);
    expect([...grouped].sort()).toEqual([...ALL].sort());
  });

  it('shows every shown switch exactly once and hides the same switches as before', () => {
    const shown = shownGroups().flatMap((group) => group.switches);
    expect([...shown].sort()).toEqual([...SHOWN_SWITCHES].sort());
    expect(shown).not.toContain('devices');
    expect(shown).not.toContain('passkeys');
    expect(shown).toHaveLength(12);
  });

  it('keeps the groups in risk order', () => {
    expect(shownGroups().map((group) => group.id)).toEqual(['everyday', 'setup', 'high-risk']);
  });
});

describe('group count', () => {
  const ids: RemoteSwitch[] = ['notifications', 'terminal', 'artifacts'];
  const off = {
    ...REMOTE_SWITCH_DEFAULTS,
    notifications: false,
    terminal: false,
    artifacts: false,
  };

  it('says all off, all on or how many are on', () => {
    expect(groupCount(ids, off)).toBe('All off');
    expect(groupCount(ids, { ...off, terminal: true })).toBe('1 of 3 on');
    expect(groupCount(ids, { ...off, terminal: true, notifications: true })).toBe('2 of 3 on');
    expect(groupCount(ids, { ...off, terminal: true, notifications: true, artifacts: true })).toBe(
      'All on',
    );
  });
});

describe('labels by state', () => {
  it('splits the shown switches into allowed and off', () => {
    const { allowed, off } = labelsByState({ ...REMOTE_SWITCH_DEFAULTS, reset: false });
    expect(off).toContain(REMOTE_SWITCH_LABELS.reset);
    expect(off).toContain(REMOTE_SWITCH_LABELS.terminal);
    expect(allowed).toContain(REMOTE_SWITCH_LABELS.settings);
    expect(allowed).not.toContain(REMOTE_SWITCH_LABELS.reset);
    expect(allowed.length + off.length).toBe(SHOWN_SWITCHES.length);
  });
});
