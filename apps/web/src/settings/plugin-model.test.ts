import { describe, expect, it } from 'vitest';
import type { PluginFinding, PluginScanStatus, UserPlugin } from '@spark-outpost/contracts';
import {
  autoRunStatus,
  autoRuns,
  decisionGroups,
  detailsSummary,
  filterPlugins,
  findingTitle,
  otherGroups,
  pluginSummary,
  shortCommand,
  sortPlugins,
} from './plugin-model.ts';

function plugin(
  name: string,
  status: PluginScanStatus,
  extra: Partial<UserPlugin> = {},
): UserPlugin {
  return {
    key: `${name}@market`,
    name,
    marketplace: 'market',
    version: null,
    description: '',
    skills: 0,
    commands: 0,
    agents: 0,
    commandNames: [],
    hooks: [],
    mcpServers: [],
    loadable: true,
    unloadableReason: null,
    fingerprint: `fp-${name}`,
    scan: { status, findings: [], agentReview: 'done' },
    enabled: false,
    changed: false,
    ...extra,
  };
}

const names = (plugins: UserPlugin[]) => plugins.map((item) => item.name);

describe('plugin order', () => {
  it('puts plugins that are on first, then flagged, then review, then the rest by name', () => {
    const list = [
      plugin('zeta', 'clean'),
      plugin('Alpha', 'clean'),
      plugin('risky', 'review'),
      plugin('bad', 'flagged'),
      plugin('on-late', 'flagged', { enabled: true }),
      plugin('beta', 'pending'),
      plugin('another-on', 'clean', { enabled: true }),
    ];
    expect(names(sortPlugins(list))).toEqual([
      'another-on',
      'on-late',
      'bad',
      'risky',
      'Alpha',
      'beta',
      'zeta',
    ]);
  });

  it('treats an enabled plugin that changed since as off', () => {
    const list = [plugin('b', 'clean'), plugin('a', 'clean', { enabled: true, changed: true })];
    expect(names(sortPlugins(list))).toEqual(['a', 'b']);
  });
});

describe('plugin filter', () => {
  const list = [
    plugin('egm', 'clean', { description: 'Engineering reviewers' }),
    plugin('warp', 'clean', { marketplace: 'claude-code-warp' }),
    plugin('notes', 'clean', { description: 'Sync notes to a remote' }),
  ];

  it('keeps every plugin when the filter is blank', () => {
    expect(names(filterPlugins(list, '  '))).toEqual(['egm', 'warp', 'notes']);
  });

  it('matches name, marketplace or description, ignoring case, and needs every word', () => {
    expect(names(filterPlugins(list, 'EGM'))).toEqual(['egm']);
    expect(names(filterPlugins(list, 'code-warp'))).toEqual(['warp']);
    expect(names(filterPlugins(list, 'remote sync'))).toEqual(['notes']);
    expect(names(filterPlugins(list, 'remote egm'))).toEqual([]);
  });
});

describe('plugin summary', () => {
  it('counts plugins that are on, installed and need review', () => {
    const list = [
      plugin('a', 'clean', { enabled: true }),
      plugin('b', 'review'),
      plugin('c', 'flagged'),
    ];
    expect(pluginSummary(list, 3)).toBe('1 on · 3 installed · 2 need review');
    expect(pluginSummary(list.slice(0, 2), 2)).toBe('1 on · 2 installed · 1 needs review');
  });

  it('leaves out review when nothing needs it and adds what a filter shows', () => {
    const list = [plugin('a', 'clean'), plugin('b', 'clean')];
    expect(pluginSummary(list, 2)).toBe('0 on · 2 installed');
    expect(pluginSummary(list, 1)).toBe('0 on · 2 installed · 1 shown');
  });
});

function finding(extra: Partial<PluginFinding> & Pick<PluginFinding, 'rule'>): PluginFinding {
  return { source: 'check', severity: 'review', file: 'f', line: null, reason: 'r', ...extra };
}

const HOOK_EVENTS = [
  'SessionStart',
  'Stop',
  'Notification',
  'UserPromptSubmit',
  'PreToolUse',
  'SubagentStop',
];

function warpLike(): UserPlugin {
  const hooks = HOOK_EVENTS.map((event) => ({
    event,
    matcher: null,
    command: `\${CLAUDE_PLUGIN_ROOT}/scripts/on-${event.toLowerCase()}.sh`,
  }));
  const scripts = HOOK_EVENTS.concat(['a', 'b', 'c']).map((name) =>
    finding({ rule: 'executable', file: `scripts/${name}.sh` }),
  );
  return plugin('warp', 'review', {
    hooks,
    scan: {
      status: 'review',
      agentReview: 'done',
      findings: [
        ...hooks.map((hook) =>
          finding({ rule: 'hook', file: 'hooks/hooks.json', reason: `Hook on ${hook.event}` }),
        ),
        ...scripts,
        finding({
          source: 'agent',
          rule: 'transcript-content-exfil-to-notifier',
          file: 'x.sh',
          line: 4,
        }),
        finding({ source: 'agent', severity: 'flagged', rule: 'curl-to-host', file: 'y.sh' }),
      ],
    },
  });
}

describe('plugin details', () => {
  it('sums up a plugin with hooks and agent findings in plain sentences', () => {
    expect(detailsSummary(warpLike())).toBe(
      'Runs 6 commands automatically on Claude events, without asking. The agent review found 2 things to check.',
    );
  });

  it('says nothing runs on its own for a plugin that only adds skills and subagents', () => {
    expect(detailsSummary(plugin('egm', 'clean', { skills: 7, agents: 9 }))).toBe(
      'Adds 7 skills and 9 subagents. Nothing runs on its own.',
    );
  });

  it('names inline shell, MCP servers and flagged check findings', () => {
    const sync = plugin('sync', 'flagged', {
      commands: 2,
      mcpServers: [{ name: 'sync', command: 'npx', args: ['sync-mcp'], url: null }],
      scan: {
        status: 'flagged',
        agentReview: 'off',
        findings: [
          finding({ rule: 'inline-shell', file: 'commands/pull.md', line: 3 }),
          finding({ rule: 'network-shell', severity: 'flagged' }),
        ],
      },
    });
    expect(detailsSummary(sync)).toBe(
      'Adds 2 commands. Its skills run 1 shell command without asking when they load. Starts its MCP server with each chat; tool calls follow the chat’s mode. Spark’s check flagged 1 thing.',
    );
  });

  it('puts findings that need a decision first, worst group and worst finding first', () => {
    const groups = decisionGroups(warpLike());
    expect(groups.map((group) => [group.label, group.severity])).toEqual([
      ['Agent review', 'flagged'],
    ]);
    expect(groups[0]!.findings.map((item) => item.rule)).toEqual([
      'curl-to-host',
      'transcript-content-exfil-to-notifier',
    ]);
    const mixed = plugin('m', 'flagged', {
      scan: {
        status: 'flagged',
        agentReview: 'done',
        findings: [
          finding({ source: 'agent', rule: 'a' }),
          finding({ rule: 'secret-read', severity: 'flagged' }),
        ],
      },
    });
    expect(decisionGroups(mixed).map((group) => group.label)).toEqual([
      'Spark check',
      'Agent review',
    ]);
  });

  it('folds hook, MCP and inline shell check findings into one automatic table', () => {
    const warp = warpLike();
    const rows = autoRuns(warp);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ when: 'SessionStart', runs: 'scripts/on-sessionstart.sh' });
    expect(rows[0]!.full).toBe('${CLAUDE_PLUGIN_ROOT}/scripts/on-sessionstart.sh');
    expect(autoRunStatus(warp)).toBe('review');
    expect(otherGroups(warp).map((group) => group.rule)).toEqual(['executable']);
    expect(otherGroups(warp)[0]!.findings).toHaveLength(9);
    expect(autoRunStatus(plugin('egm', 'clean'))).toBeNull();
  });

  it('shortens the plugin root in commands', () => {
    expect(shortCommand('node $CLAUDE_PLUGIN_ROOT/bin/a.js ${CLAUDE_PLUGIN_ROOT}/x')).toBe(
      'node bin/a.js x',
    );
  });

  it('shows the finding title and falls back to the rule id in words', () => {
    expect(findingTitle({ rule: 'network-shell', title: 'Downloads and runs code' })).toBe(
      'Downloads and runs code',
    );
    expect(findingTitle({ rule: 'transcript-content-exfil-to-notifier' })).toBe(
      'Transcript content exfil to notifier',
    );
  });
});
