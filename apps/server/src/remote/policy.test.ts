import { describe, expect, it } from 'vitest';
import {
  REMOTE_SWITCH_DEFAULTS,
  remoteSwitchSchema,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { blockedFieldIn, cardSwitch, remoteDecision } from './policy.ts';
import { ROUTE_RULES } from './route-rules.ts';

const ID = '0198c0de-0000-7000-8000-000000000001';
const ALL_ON = Object.fromEntries(
  remoteSwitchSchema.options.map((name) => [name, true]),
) as RemoteSwitches;
const ALL_OFF = Object.fromEntries(
  remoteSwitchSchema.options.map((name) => [name, false]),
) as RemoteSwitches;

function concrete(route: string): [string, string] {
  const [method, path] = route.split(' ') as [string, string];
  return [method, path.replace(/:[A-Za-z]+/g, ID).replace('{*path}', 'index.html')];
}

const kindOf = (route: string, switches: RemoteSwitches) =>
  remoteDecision(...concrete(route), switches).kind;

describe('remote policy', () => {
  it('refuses anything that has no rule', () => {
    expect(remoteDecision('GET', '/api/brand-new', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('POST', '/api/conversations/x/y/z', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('OPTIONS', '/api/conversations', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('POST', '/index.html', ALL_ON).kind).toBe('refuse');
  });

  it('allows the always list whatever the switches say', () => {
    for (const [route, rule] of ROUTE_RULES) {
      if (rule === 'always') expect([route, kindOf(route, ALL_OFF)]).toEqual([route, 'allow']);
    }
  });

  it('refuses the never list whatever the switches say', () => {
    for (const [route, rule] of ROUTE_RULES) {
      if (rule === 'never') expect([route, kindOf(route, ALL_ON)]).toEqual([route, 'refuse']);
    }
  });

  it.each(remoteSwitchSchema.options)('blocks the %s routes when off, allows when on', (name) => {
    const routes = [...ROUTE_RULES].filter(([, rule]) => rule === name).map(([route]) => route);
    for (const route of routes) {
      expect([route, kindOf(route, { ...ALL_ON, [name]: false })]).toEqual([route, 'refuse']);
      expect([route, kindOf(route, { ...ALL_OFF, [name]: true })]).toEqual([route, 'allow']);
    }
  });

  it('keeps terminal, preview, Tailscale, devices and pairing start away from phones', () => {
    const refused: [string, string][] = [
      ['POST', '/api/terminal/sessions'],
      ['POST', '/api/terminal/shells'],
      ['DELETE', `/api/terminal/sessions/${ID}`],
      ['GET', `/api/terminal/sessions/${ID}/stream`],
      ['POST', `/api/conversations/${ID}/preview/start`],
      ['POST', '/api/remote/pairings'],
      ['GET', '/api/remote/devices'],
      ['PATCH', '/api/remote/switches'],
      ['PUT', '/api/remote/access'],
      ['GET', '/api/diagnostics/export'],
      ['GET', '/api/remote/tailscale'],
      ['POST', '/api/remote/tailscale/on'],
      ['POST', '/api/remote/tailscale/off'],
      ['GET', '/api/instructions-file'],
      ['POST', '/api/setup/git/install'],
      ['POST', `/api/conversations/${ID}/workspace/open`],
    ];
    for (const [method, path] of refused) {
      expect([path, remoteDecision(method, path, ALL_ON).kind]).toEqual([path, 'refuse']);
    }
    expect(remoteDecision('POST', '/api/reset', ALL_OFF).kind).toBe('refuse');
  });

  it('allows everything else by default, and opening a pull request always', () => {
    expect(remoteDecision('POST', '/api/reset', REMOTE_SWITCH_DEFAULTS).kind).toBe('allow');
    expect(
      remoteDecision('POST', `/api/projects/${ID}/sign-ins`, REMOTE_SWITCH_DEFAULTS).kind,
    ).toBe('allow');
    expect(remoteDecision('POST', `/api/tasks/${ID}/ship`, ALL_OFF).kind).toBe('allow');
    const trust = `/api/projects/${ID}/agent-config/trust`;
    expect(remoteDecision('PUT', trust, REMOTE_SWITCH_DEFAULTS).kind).toBe('allow');
    expect(remoteDecision('PUT', trust, { ...ALL_ON, settings: false }).kind).toBe('refuse');
  });

  it('matches the way the router does: any case, trailing slash, HEAD as GET', () => {
    expect(remoteDecision('POST', '/API/Terminal/Sessions/', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('POST', '/api/RESET', ALL_OFF).kind).toBe('refuse');
    expect(remoteDecision('HEAD', '/api/conversations/', ALL_OFF).kind).toBe('allow');
    expect(remoteDecision('GET', '/assets/app.js', ALL_OFF).kind).toBe('allow');
  });

  it('marks pairing routes apart from the allowlist', () => {
    expect(remoteDecision('POST', '/api/remote/pair', ALL_OFF).kind).toBe('pairing');
    expect(remoteDecision('POST', '/api/remote/pair/claim', ALL_OFF).kind).toBe('pairing');
  });

  it('blocks mode and autonomy fields only when that switch is off', () => {
    const path = `/api/conversations/${ID}/settings`;
    const off = remoteDecision('PATCH', path, { ...ALL_ON, agentMode: false });
    const on = remoteDecision('PATCH', path, ALL_ON);
    expect(off).toMatchObject({
      kind: 'allow',
      blockedFields: ['agentMode', 'permission', 'level'],
    });
    expect(on).toMatchObject({ kind: 'allow', blockedFields: [] });
    expect(blockedFieldIn({ model: 'x', level: 'full-auto' }, ['agentMode', 'level'])).toBe(
      'level',
    );
    expect(blockedFieldIn({ model: 'x' }, ['agentMode', 'level'])).toBeNull();
  });

  it('sorts cards into ordinary, high-risk and sign-in', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    expect(cardSwitch({ ...base, command: 'pnpm test' })).toBeNull();
    expect(cardSwitch({ ...base, gitControl: ['.git/hooks/pre-commit'] })).toBe('highRiskCards');
    expect(cardSwitch({ ...base, forcePush: ['main'] })).toBe('highRiskCards');
    expect(cardSwitch({ ...base, instructionFiles: ['AGENTS.md'] })).toBe('highRiskCards');
    expect(cardSwitch({ ...base, paths: ['config/.env'] })).toBe('highRiskCards');
    expect(cardSwitch({ ...base, fullPaths: ['/repo/.env.local'] })).toBe('highRiskCards');
    expect(cardSwitch({ unexpected: true })).toBe('highRiskCards');
  });
});
