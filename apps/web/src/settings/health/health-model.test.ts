import { describe, expect, it } from 'vitest';
import type {
  CalendarStatus,
  ConversationSummary,
  NativeTerminalSession,
  Project,
  ProviderSetup,
  RepoAgentConfig,
  SparkRules,
  UserPlugin,
  VoiceStatus,
} from '@spark-outpost/contracts';
import {
  cloudflareHealth,
  agentConfigHealth,
  failedChatsHealth,
  helpersHealth,
  pluginsHealth,
  projectsHealth,
  providersHealth,
  rulesHealth,
  terminalsHealth,
} from './health-model.ts';
import { HEALTH_EMPTY, healthSummary } from './health-summary.ts';

const RULES: SparkRules = { rows: [], ghAllowed: [], unused: [], problems: [], malformed: false };

const PROJECT = { id: 'p1', name: 'web' } as Project;

function config(extra: Partial<RepoAgentConfig>): RepoAgentConfig {
  return {
    warnings: [],
    ignored: [],
    trust: { needed: false, state: 'unset' },
    ...extra,
  } as unknown as RepoAgentConfig;
}

function chat(extra: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'c1',
    title: 'Fix the build',
    archivedAt: null,
    latestRun: null,
    terminal: null,
    ...extra,
  } as ConversationSummary;
}

function terminal(extra: Partial<NativeTerminalSession>): NativeTerminalSession {
  return { id: 't1', state: 'idle', mod: null, ...extra } as NativeTerminalSession;
}

const keysOf = (items: { key: string }[]) => items.map((item) => item.key);

describe('rulesHealth', () => {
  it('reports nothing for a clean rules file', () => {
    expect(rulesHealth(RULES)).toEqual([]);
  });

  it('reports a malformed file once, with its reason, and sends the fix to Spark rules', () => {
    const items = rulesHealth({
      ...RULES,
      malformed: true,
      problems: [{ file: 'user', message: 'Unexpected token' }],
    } as SparkRules);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: 'broken',
      title: 'settings.json can’t be used',
      fix: { kind: 'section', section: 'rules' },
    });
    expect(items[0]!.detail).toContain('Unexpected token');
  });

  it('lists company problems, an outside change once and unused entries', () => {
    const items = rulesHealth({
      ...RULES,
      problems: [
        { file: 'user', message: 'The file changed outside Spark, so Spark keeps…' },
        { file: 'managed', message: 'Bad key' },
      ],
      unused: [
        { entry: 'Bash(rm)', kind: 'agent-tool' },
        { entry: 'theme', kind: 'key' },
      ],
      outsideChange: { added: [], removed: [], fileHash: 'h' },
    } as unknown as SparkRules);
    expect(items.map((item) => item.title)).toEqual([
      'Problem in your company’s rules file',
      'Rules file changed outside Spark',
      "2 entries in your file aren't used",
    ]);
    expect(items[2]!.detail).toBe('Bash(rm), theme');
    expect(items[2]!.status).toBe('ignored');
  });
});

describe('agentConfigHealth', () => {
  it('skips projects whose switches are only off', () => {
    expect(agentConfigHealth(PROJECT, config({}))).toEqual([]);
  });

  it('reports skipped settings, a changed trusted setup and ignored repo settings', () => {
    const items = agentConfigHealth(
      PROJECT,
      config({
        warnings: ['.mcp.json is not valid JSON, so it was skipped.'],
        trust: { needed: true, state: 'changed' } as RepoAgentConfig['trust'],
        ignored: [
          { kind: 'env', source: '.claude/settings.json', items: ['A', 'B'] },
        ] as RepoAgentConfig['ignored'],
      }),
    );
    expect(items.map((item) => item.status)).toEqual(['broken', 'ignored', 'ignored']);
    expect(items[2]!.title).toBe('web: 2 repo settings never applied');
    expect(items[2]!.detail).toBe('Environment variables (.claude/settings.json)');
    expect(items[0]!.fix.kind).toBe('note');
  });
});

describe('projectsHealth', () => {
  it('names a project whose setup could not be read instead of failing the whole check', () => {
    const items = projectsHealth([
      { project: PROJECT, config: undefined, error: new Error('Folder not found') },
      { project: { id: 'p2', name: 'api' } as Project, config: config({}), error: null },
    ]);
    expect(items).toEqual([
      {
        key: 'config:p1:error',
        status: 'broken',
        title: 'web: couldn’t read its setup',
        detail: 'Folder not found',
        fix: { kind: 'section', section: 'projects', label: 'Open Projects' },
      },
    ]);
  });
});

describe('pluginsHealth', () => {
  it('lists only plugins that cannot load, with the reason or a fallback', () => {
    const plugins = [
      { key: 'a', name: 'Alpha', loadable: true, unloadableReason: null },
      { key: 'b', name: 'Beta', loadable: false, unloadableReason: 'Too large' },
      { key: 'c', name: 'Gamma', loadable: false, unloadableReason: null },
    ] as UserPlugin[];
    const items = pluginsHealth(plugins);
    expect(keysOf(items)).toEqual(['plugin:b', 'plugin:c']);
    expect(items.map((item) => item.detail)).toEqual([
      'Too large',
      'This plugin can’t load in chats.',
    ]);
    expect(items[0]!.fix).toMatchObject({ section: 'chats', focus: 'Claude plugins' });
  });
});

describe('terminalsHealth', () => {
  const missing = { state: 'missing', reason: 'managed settings block plugins' } as const;

  it('lists running sessions whose mod did not load and opens their chat', () => {
    const items = terminalsHealth([
      chat({ id: 'c1', terminal: terminal({ mod: missing }) }),
      chat({ id: 'c2', terminal: terminal({ mod: { state: 'loaded', reason: null } }) }),
      chat({ id: 'c3', terminal: null }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.detail).toContain('managed settings block plugins');
    expect(items[0]!.fix).toEqual({ kind: 'chat', conversationId: 'c1', label: 'Open chat' });
  });

  it('skips ended sessions, archived chats and Ask Spark', () => {
    expect(
      terminalsHealth([
        chat({ terminal: terminal({ mod: missing, state: 'exited' }) }),
        chat({ archivedAt: '2026-11-01T00:00:00Z', terminal: terminal({ mod: missing }) }),
        chat({ assistant: true, terminal: terminal({ mod: missing }) }),
      ]),
    ).toEqual([]);
  });
});

describe('failedChatsHealth', () => {
  const run = (status: string, error: string | null) =>
    ({ id: `r-${status}`, status, error }) as ConversationSummary['latestRun'];

  it('lists chats whose last turn failed with an error', () => {
    const items = failedChatsHealth([
      chat({ latestRun: run('failed', 'Claude couldn’t sign in (expired).') }),
      chat({ latestRun: run('succeeded', null) }),
      chat({ latestRun: run('failed', null) }),
      chat({ sessionType: 'terminal', latestRun: run('failed', 'boom') }),
    ]);
    expect(items.map((item) => item.detail)).toEqual(['Claude couldn’t sign in (expired).']);
  });
});

describe('providersHealth', () => {
  it('lists providers whose last check failed', () => {
    const providers = [
      {
        id: 'claude',
        name: 'Claude',
        connection: { lastTest: { ok: false, message: 'Signed out' } },
      },
      { id: 'codex', name: 'Codex', connection: { lastTest: { ok: true, message: 'OK' } } },
      { id: 'zai', name: 'Z.ai', connection: null },
    ] as unknown as ProviderSetup[];
    const items = providersHealth(providers);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Claude didn’t pass its last check',
      detail: 'Signed out',
      fix: { section: 'ai' },
    });
  });
});

describe('cloudflareHealth', () => {
  const fine = { connected: true, problem: null };
  const running = { connected: 'spark.example.com', tunnel: 'running' as const };

  it('says nothing while the share service and the tunnel work, or are not set up', () => {
    expect(cloudflareHealth(fine, running)).toEqual([]);
    expect(
      cloudflareHealth({ connected: false, problem: null }, { connected: null, tunnel: 'off' }),
    ).toEqual([]);
    expect(cloudflareHealth(fine, { ...running, tunnel: 'starting' })).toEqual([]);
  });

  it('lists a share service whose last check failed, with what the check said', () => {
    const [item] = cloudflareHealth(
      { connected: true, problem: 'The share service refused that upload key.' },
      running,
    );
    expect(item).toMatchObject({
      key: 'cloudflare:share',
      status: 'broken',
      detail: 'The share service refused that upload key.',
    });
    expect(item?.fix).toMatchObject({ kind: 'note' });
  });

  it('lists a tunnel that stopped for the address this computer is reached at', () => {
    const [item] = cloudflareHealth(fine, { ...running, tunnel: 'stopped' });
    expect(item?.title).toBe('The Cloudflare tunnel for spark.example.com isn’t connected');
    expect(cloudflareHealth(fine, { connected: null, tunnel: 'stopped' })).toEqual([]);
  });
});

describe('helpersHealth', () => {
  it('reports missing helpers only where Spark reports them', () => {
    expect(helpersHealth({ macControl: null, voice: null, calendar: null })).toEqual([]);
    const items = helpersHealth({
      macControl: { supported: true, trusted: false, helper: 'missing' },
      voice: { helper: 'failed' } as VoiceStatus,
      calendar: { supported: true, helper: 'missing' } as CalendarStatus,
    });
    expect(items.map((item) => item.fix)).toEqual([
      { kind: 'note', text: 'From source, run pnpm desktop:mac-control.' },
      { kind: 'note', text: 'From source, run pnpm desktop:voice.' },
      { kind: 'note', text: 'From source, run pnpm desktop:calendar.' },
    ]);
  });

  it('ignores the calendar helper where the calendar is not supported', () => {
    const calendar = { supported: false, helper: 'missing' } as CalendarStatus;
    expect(helpersHealth({ macControl: null, voice: null, calendar })).toEqual([]);
  });
});

describe('healthSummary', () => {
  const item = { key: 'k' } as never;

  it('says everything looks fine only once every source is ready and clean', () => {
    expect(healthSummary([{ state: 'ready', items: [] }]).text).toBe(HEALTH_EMPTY);
    expect(healthSummary([{ state: 'checking', items: [] }]).kind).toBe('checking');
    expect(healthSummary([{ state: 'failed', items: [] }]).kind).toBe('unchecked');
  });

  it('counts problems even while other sources are still checking', () => {
    expect(
      healthSummary([
        { state: 'ready', items: [item, item] },
        { state: 'checking', items: [] },
      ]),
    ).toEqual({ kind: 'problems', text: '2 things to look at' });
  });
});
