import { describe, expect, it } from 'vitest';
import {
  FIXED_ON_MAC_REASON,
  STEP_UP_NEEDS_PASSKEY,
  cardSwitch,
  kindOnMacReason,
  macOnlyCard,
  remoteCardKind,
  remoteCardPlace,
  type RemoteCardContext,
} from './remote-cards.ts';
import { approvalPayloadSchema } from './approvals.ts';
import {
  REMOTE_CARD_ANSWERING_DEFAULT,
  REMOTE_SWITCH_DEFAULTS,
  type RemoteCardAnswering,
} from './remote.ts';

const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };

const rules = (target: 'user' | 'managed') => ({
  ...base,
  sparkAction: {
    action: 'rules_edit',
    target,
    add: [{ effect: 'deny', rule: 'Push(force)' }],
    remove: [],
    fileHash: 'abc',
    agent: 'Claude',
    modeName: 'Manual',
    provider: 'claude',
    agentMode: 'default',
    sessionRow: null,
  },
});

const crew = {
  ...base,
  sparkAction: {
    action: 'crew_edit',
    target: 'workflow',
    id: 'nightly',
    name: 'Nightly',
    files: [{ path: 'nightly.json', change: 'new', before: null, after: '{}\n', baseHash: null }],
    stages: [['Scout']],
    similar: [],
    agent: 'Claude',
    modeName: 'Manual',
  },
};

const mac = {
  ...base,
  sparkAction: {
    action: 'mac_press',
    app: 'Notes',
    bundleId: 'com.apple.Notes',
    what: 'New Note',
    window: null,
  },
};

const calendar = { ...base, sparkAction: { action: 'calendar_read', what: 'today' } };
const openAddress = {
  ...base,
  openAddress: { url: 'https://example.com/', host: 'example.com', message: '' },
};
const handoff = {
  ...base,
  sparkAction: { action: 'browser_handoff', agent: 'Claude', site: 'example.com', tabId: 't1' },
};

const CARDS = {
  ordinary: { ...base, command: 'pnpm test' },
  gitControl: { ...base, command: 'x', gitControl: ['.git/config'] },
  forcePush: { ...base, command: 'git push -f', forcePush: ['spark/x'] },
  secretSend: { ...base, command: 'git push', secretSend: ['.env'] },
  instructionFiles: { ...base, paths: ['AGENTS.md'], instructionFiles: ['AGENTS.md'] },
  secretPath: { ...base, paths: ['config/.env'] },
  rulesUser: rules('user'),
  rulesManaged: rules('managed'),
  crew,
  mac,
  calendar,
  openAddress,
  handoff,
};

function context(answering: RemoteCardAnswering, passkey = false): RemoteCardContext {
  return { switches: { ...REMOTE_SWITCH_DEFAULTS }, answering, passkey };
}

const everywhere: RemoteCardAnswering = { from: 'devices', macOnly: [] };

describe('where a paired device may answer a card', () => {
  it('uses valid card payloads', () => {
    for (const [name, card] of Object.entries(CARDS)) {
      expect(approvalPayloadSchema.safeParse(card).success, name).toBe(true);
    }
  });

  it('never answers on a device by default where today it was refused', () => {
    for (const highRiskCards of [false, true]) {
      for (const passkey of [false, true]) {
        const switches = { ...REMOTE_SWITCH_DEFAULTS, highRiskCards };
        for (const [name, card] of Object.entries(CARDS)) {
          const needed = cardSwitch(card);
          const today = macOnlyCard(card) || (needed !== null && !switches[needed]);
          const place = remoteCardPlace(card, {
            switches,
            answering: REMOTE_CARD_ANSWERING_DEFAULT,
            passkey,
          });
          if (today) expect(place.place, name).not.toBe('here');
        }
      }
    }
  });

  it('keeps every Mac-only kind on the Mac by default', () => {
    for (const card of [CARDS.rulesUser, CARDS.crew, CARDS.mac, CARDS.calendar]) {
      const kind = remoteCardKind(approvalPayloadSchema.parse(card))!;
      expect(remoteCardPlace(card, context(REMOTE_CARD_ANSWERING_DEFAULT, true))).toEqual({
        place: 'mac',
        reason: kindOnMacReason(kind),
      });
    }
  });

  it('lets a device answer Sparks and workflows and calendar cards once turned on', () => {
    const on = context(everywhere);
    expect(remoteCardPlace(CARDS.crew, on)).toEqual({ place: 'here' });
    expect(remoteCardPlace(CARDS.calendar, on)).toEqual({ place: 'here' });
    expect(remoteCardPlace(CARDS.ordinary, on)).toEqual({ place: 'here' });
  });

  it('keeps a kind on the Mac when its override says so', () => {
    const kept = context({ from: 'devices', macOnly: ['crew'] });
    expect(remoteCardPlace(CARDS.crew, kept)).toEqual({
      place: 'mac',
      reason: kindOnMacReason('crew'),
    });
    expect(remoteCardPlace(CARDS.calendar, kept)).toEqual({ place: 'here' });
  });

  it('asks for the passkey on rules, Mac control and press-and-hold cards', () => {
    for (const card of [CARDS.rulesUser, CARDS.mac, CARDS.gitControl, CARDS.forcePush]) {
      expect(remoteCardPlace(card, context(everywhere, true))).toEqual({ place: 'step_up' });
      expect(remoteCardPlace(card, context(everywhere, false))).toEqual({
        place: 'mac',
        reason: STEP_UP_NEEDS_PASSKEY,
      });
    }
    expect(remoteCardPlace(CARDS.secretSend, context(everywhere, true))).toEqual({
      place: 'step_up',
    });
  });

  it('keeps cards that act on the Mac itself there whatever the setting', () => {
    for (const card of [CARDS.rulesManaged, CARDS.openAddress, CARDS.handoff]) {
      expect(remoteCardPlace(card, context(everywhere, true))).toEqual({
        place: 'mac',
        reason: FIXED_ON_MAC_REASON,
      });
    }
  });

  it('still follows the high-risk switch before the passkey', () => {
    const off = {
      ...context(everywhere, true),
      switches: { ...REMOTE_SWITCH_DEFAULTS, highRiskCards: false },
    };
    expect(remoteCardPlace(CARDS.gitControl, off)).toMatchObject({
      place: 'mac',
      switch: 'highRiskCards',
    });
    expect(remoteCardPlace(CARDS.secretPath, off)).toMatchObject({ place: 'mac' });
    expect(remoteCardPlace({ unexpected: true }, off)).toMatchObject({ place: 'mac' });
  });
});
