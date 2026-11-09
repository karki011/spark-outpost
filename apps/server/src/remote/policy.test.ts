import { describe, expect, it } from 'vitest';
import {
  REMOTE_SWITCH_DEFAULTS,
  remoteSwitchSchema,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { blockedFieldIn, cardSwitch, macOnlyCard, remoteDecision } from './policy.ts';
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

  it('lets a paired device follow live runs on the shared run stream, with the switches off', () => {
    expect(remoteDecision('GET', '/api/run-events', ALL_OFF).kind).toBe('allow');
    expect(remoteDecision('POST', '/api/run-events', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('GET', `/api/runs/${ID}/events`, ALL_ON).kind).toBe('refuse');
  });

  it('keeps the merged Terminal poll on the Mac whatever the switches say', () => {
    expect(remoteDecision('GET', '/api/terminal-live', ALL_ON).kind).toBe('refuse');
  });

  it('lets a paired device read the inbox and mark its items, with the switches off', () => {
    expect(remoteDecision('GET', '/api/attention', ALL_OFF).kind).toBe('allow');
    for (const mark of ['read', 'set-aside', 'dismiss']) {
      const path = `/api/attention/approval:${ID}/${mark}`;
      expect([mark, remoteDecision('POST', path, ALL_OFF).kind]).toEqual([mark, 'allow']);
    }
    expect(remoteDecision('POST', `/api/attention/chats/${ID}/read`, ALL_OFF).kind).toBe('allow');
    expect(remoteDecision('POST', `/api/attention/approval:${ID}/allow`, ALL_ON).kind).toBe(
      'refuse',
    );
    expect(remoteDecision('DELETE', `/api/attention/approval:${ID}/read`, ALL_ON).kind).toBe(
      'refuse',
    );
  });

  it('lets a paired device start a proposed draft as proposed, but not create or edit outposts', () => {
    expect(remoteDecision('POST', `/api/outposts/drafts/${ID}/start`, ALL_OFF).kind).toBe('allow');
    expect(remoteDecision('GET', `/api/outposts/drafts/${ID}`, ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('POST', '/api/outposts', ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('DELETE', `/api/outposts/${ID}`, ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('PUT', `/api/outposts/${ID}/members/${ID}`, ALL_ON).kind).toBe('refuse');
    expect(remoteDecision('PUT', `/api/outposts/${ID}/instructions`, ALL_ON).kind).toBe('refuse');
  });

  it('lets a paired device answer a start-sub-chats card like other Spark action cards', () => {
    const action = {
      action: 'start_outpost',
      draftId: ID,
      outpostName: 'Docs split',
      joining: false,
      title: 'Read the docs',
      chats: [
        {
          handle: 'api',
          title: 'Read api docs',
          project: 'shop',
          agentMode: null,
          dependsOn: null,
          stacked: false,
          task: 'Read.',
        },
      ],
    };
    const payload = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    expect(cardSwitch({ ...payload, sparkAction: action })).toBeNull();
  });

  it('needs High-risk cards on a paired device for an Ask Spark card that answers another card', () => {
    const payload = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const ask = {
      action: 'ask_spark' as const,
      summary: 'Allow once: Run pnpm deploy',
      conversationId: null,
      projectId: null,
      approvalId: '11111111-1111-4111-8111-111111111111',
      answer: 'allow_once' as const,
      ticket: null,
      text: null,
    };
    expect(cardSwitch({ ...payload, sparkAction: { ...ask, op: 'answer_card' } })).toBe(
      'highRiskCards',
    );
    expect(cardSwitch({ ...payload, sparkAction: { ...ask, op: 'stop_turn' } })).toBeNull();
  });

  it('lets a paired device pause and resume Spark whatever the switches say', () => {
    expect(remoteDecision('GET', '/api/spark-pause', ALL_OFF).kind).toBe('allow');
    expect(remoteDecision('PUT', '/api/spark-pause', ALL_OFF).kind).toBe('allow');
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
      ['GET', '/api/chat-ports'],
      ['POST', `/api/terminal/sessions/${ID}/attach`],
      ['POST', `/api/conversations/${ID}/terminal`],
      ['GET', `/api/conversations/${ID}/terminal/usage`],
      ['DELETE', `/api/conversations/${ID}/terminal`],
      ['DELETE', `/api/terminal/sessions/${ID}`],
      ['GET', `/api/terminal/sessions/${ID}/stream`],
      ['POST', `/api/conversations/${ID}/preview/start`],
      ['POST', '/api/remote/pairings'],
      ['GET', '/api/remote/devices'],
      ['PATCH', '/api/remote/switches'],
      ['GET', '/api/remote/push/contact'],
      ['PUT', '/api/remote/push/contact'],
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

  it('lets a phone use a Terminal session only behind its two switches, both off by default', () => {
    const follow: [string, string][] = [
      ['GET', `/api/conversations/${ID}/terminal`],
      ['GET', `/api/conversations/${ID}/terminal/transcript`],
      ['POST', `/api/conversations/${ID}/terminal/message`],
      ['POST', `/api/conversations/${ID}/terminal/interrupt`],
    ];
    const approve = ['POST', `/api/conversations/${ID}/terminal/approval`] as const;
    for (const [method, path] of [...follow, approve]) {
      expect([path, remoteDecision(method, path, REMOTE_SWITCH_DEFAULTS).kind]).toEqual([
        path,
        'refuse',
      ]);
      expect([path, remoteDecision(method, path, ALL_ON).kind]).toEqual([path, 'allow']);
    }
    const followOnly = { ...ALL_OFF, terminal: true };
    for (const [method, path] of follow)
      expect(remoteDecision(method, path, followOnly).kind).toBe('allow');
    expect(remoteDecision(...approve, followOnly).kind).toBe('refuse');
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

  it('opens passkey sign-in without a device only while its switch is on', () => {
    const routes = [...ROUTE_RULES]
      .filter(([, rule]) => rule === 'passkey')
      .map(([route]) => route);
    expect(routes).toEqual([
      'POST /api/remote/passkey/sign-in/options',
      'POST /api/remote/passkey/sign-in',
    ]);
    for (const route of routes) {
      expect(kindOf(route, { ...ALL_OFF, passkeys: true })).toBe('pairing');
      expect(kindOf(route, { ...ALL_ON, passkeys: false })).toBe('refuse');
    }
  });

  it('needs a paired device to save a passkey and keeps removal on the Mac', () => {
    expect(kindOf('POST /api/remote/passkeys/options', ALL_ON)).toBe('allow');
    expect(kindOf('POST /api/remote/passkeys', ALL_ON)).toBe('allow');
    expect(kindOf('GET /api/remote/passkeys', ALL_ON)).toBe('allow');
    expect(kindOf('POST /api/remote/passkeys', { ...ALL_ON, passkeys: false })).toBe('refuse');
    expect(kindOf('DELETE /api/remote/devices/:id/passkeys', ALL_ON)).toBe('refuse');
  });

  it('lets a device turn notifications on only while its switch is on, and off at any time', () => {
    const on = 'PUT /api/remote/push/subscription';
    expect(kindOf(on, ALL_ON)).toBe('allow');
    expect(kindOf(on, { ...ALL_ON, notifications: false })).toBe('refuse');
    expect(kindOf('DELETE /api/remote/push/subscription', ALL_OFF)).toBe('allow');
    expect(kindOf('GET /api/remote/push', ALL_OFF)).toBe('allow');
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

  it('needs High-risk cards for a ticket comment the caller sees', () => {
    const path = '/api/tickets/servicenow/INC0010023/comments';
    const off = remoteDecision('POST', path, { ...ALL_ON, highRiskCards: false });
    expect(off).toMatchObject({ kind: 'allow', highRiskFields: ['visibility'] });
    expect(remoteDecision('POST', path, ALL_ON)).toMatchObject({ highRiskFields: [] });
    expect(blockedFieldIn({ body: 'hi', visibility: 'customer' }, ['visibility'])).toBe(
      'visibility',
    );
    expect(blockedFieldIn({ body: 'a work note' }, ['visibility'])).toBeNull();
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

  it('lets a paired device answer an agent’s question like an ordinary card', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const field = {
      key: 'name',
      kind: 'text',
      question: 'What should the cache be called?',
      options: [],
      required: true,
      noteKey: null,
      otherValue: null,
      minimum: null,
      maximum: null,
      minLength: null,
      maxLength: null,
      minItems: null,
      maxItems: null,
      default: null,
    };
    const question = { ...base, form: { message: 'Codex needs your input.', fields: [field] } };
    expect(cardSwitch(question)).toBeNull();
    expect(macOnlyCard(question)).toBe(false);
  });

  it('keeps a card that opens an address on the Mac, with or without a secret value', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const openAddress = {
      url: 'https://auth.example.com/a',
      host: 'auth.example.com',
      message: '',
    };
    expect(macOnlyCard({ ...base, openAddress })).toBe(true);
    expect(macOnlyCard({ ...base, openAddress, secretSend: ['.env'] })).toBe(true);
  });

  it('keeps Jira and Confluence deletes behind the high-risk switch and other changes ordinary', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const ticket = { key: 'WEB-1', title: 'A', url: 'https://acme.atlassian.net/browse/WEB-1' };
    const jira = (op: string) => ({
      ...base,
      sparkAction: {
        action: 'jira_edit',
        op,
        ticket,
        updated: null,
        changes: {},
        before: null,
        after: null,
        comment: null,
        subtasks: [],
      },
    });
    const page = {
      id: '9001',
      title: 'Page',
      url: null,
      version: 1,
      spaceId: '1',
      space: null,
      parentId: null,
    };
    const confluence = (op: string) => ({
      ...base,
      sparkAction: { action: 'confluence_edit', op, page, body: null, before: null, after: null },
    });
    expect(cardSwitch(jira('update'))).toBeNull();
    expect(cardSwitch(jira('delete'))).toBe('highRiskCards');
    expect(cardSwitch(jira('delete_comment'))).toBe('highRiskCards');
    expect(cardSwitch(confluence('comment'))).toBeNull();
    expect(cardSwitch(confluence('delete'))).toBe('highRiskCards');
  });

  it('keeps a ServiceNow comment the caller sees and a final move behind the high-risk switch', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const serviceNowCard = (op: string, final: boolean) => ({
      ...base,
      sparkAction: {
        action: 'servicenow_edit',
        op,
        record: {
          table: 'incident',
          number: 'INC0010023',
          sysId: 'a1b2c3',
          title: 'VPN drops',
          url: 'https://acme.service-now.com/x',
          caller: null,
        },
        updated: '2026-10-20 14:03:11',
        changes: {},
        before: null,
        after: null,
        note: op === 'move' ? null : 'Text',
        move:
          op === 'move'
            ? {
                from: 'New',
                to: final ? 'Resolved' : 'In Progress',
                value: '6',
                final,
                closeCode: null,
                closeNotes: final ? 'Done' : null,
              }
            : null,
      },
    });
    expect(cardSwitch(serviceNowCard('work_note', false))).toBeNull();
    expect(cardSwitch(serviceNowCard('move', false))).toBeNull();
    expect(cardSwitch(serviceNowCard('comment', false))).toBe('highRiskCards');
    expect(cardSwitch(serviceNowCard('move', true))).toBe('highRiskCards');
  });

  it('lets a paired device answer the browser’s site cards, and keeps saved sign-ins behind their switch', () => {
    const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };
    const site = { origin: 'https://docs.example.com', path: '/guide' };
    const act = {
      action: 'act_page',
      ...site,
      title: 'Docs',
      did: 'Clicked button',
      userTab: true,
    };
    const cards = [
      { action: 'open_page', ...site },
      { action: 'read_page', ...site, title: 'Docs', what: 'read' },
      act,
    ];
    for (const sparkAction of cards) {
      expect(cardSwitch({ ...base, sparkAction }), sparkAction.action).toBeNull();
    }
    expect(cardSwitch({ ...base, sparkAction: act, secretSend: ['.env'] })).toBeNull();
    expect(
      cardSwitch({
        ...base,
        sparkAction: {
          action: 'browser_sign_in',
          signInId: '11111111-2222-4333-8444-555555555555',
          projectId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          label: 'Staging admin',
          origin: 'https://staging.example.com',
        },
      }),
    ).toBe('signIns');
  });
});
