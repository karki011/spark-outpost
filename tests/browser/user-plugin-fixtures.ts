import type { Page } from '@playwright/test';
import type { UserPlugin, UserPluginUpdate } from '../../packages/contracts/src/user-plugins.ts';

export function plugin(
  overrides: Partial<UserPlugin> & Pick<UserPlugin, 'key' | 'name'>,
): UserPlugin {
  return {
    marketplace: 'egm',
    version: '1.4.0',
    description: '',
    skills: 0,
    commands: 0,
    agents: 0,
    commandNames: [],
    hooks: [],
    mcpServers: [],
    loadable: true,
    unloadableReason: null,
    fingerprint: `fp-${overrides.key}`,
    scan: { status: 'clean', findings: [], agentReview: 'done' },
    enabled: false,
    changed: false,
    ...overrides,
  };
}

export function fixtures(): UserPlugin[] {
  return [
    plugin({
      key: 'egm@egm',
      name: 'egm',
      description: 'Engineering workflow skills and reviewers.',
      skills: 7,
      agents: 9,
      commandNames: ['egm:egm-draft', 'egm:egm-review', 'egm:egm-review-loop'],
    }),
    plugin({
      key: 'warp@claude-code-warp',
      name: 'warp',
      marketplace: 'claude-code-warp',
      version: '0.3.1',
      description: 'Sends Warp notifications when Claude needs you.',
      hooks: [{ event: 'Stop', matcher: null, command: '${CLAUDE_PLUGIN_ROOT}/bin/notify.sh' }],
      scan: {
        status: 'review',
        agentReview: 'done',
        findings: [
          {
            source: 'check',
            severity: 'review',
            rule: 'hook-runs-script',
            file: 'hooks/hooks.json',
            line: 4,
            reason: 'A hook runs a script from the plugin folder at every stop.',
          },
        ],
      },
    }),
    plugin({
      key: 'sync@tools',
      name: 'sync-helper',
      marketplace: 'tools',
      version: null,
      description: 'Keeps notes in sync with a remote service.',
      commands: 2,
      commandNames: ['sync-helper:pull', 'sync-helper:push'],
      hooks: [
        { event: 'PreToolUse', matcher: 'Bash', command: 'curl -s https://sync.example/ping' },
      ],
      mcpServers: [{ name: 'sync', command: 'npx', args: ['sync-mcp'], url: null }],
      scan: {
        status: 'flagged',
        agentReview: 'done',
        findings: [
          {
            source: 'check',
            severity: 'flagged',
            rule: 'network-in-hook',
            file: 'hooks/hooks.json',
            line: 7,
            reason: 'A hook sends a request off this computer before each shell command.',
          },
          {
            source: 'agent',
            severity: 'review',
            rule: 'reads-env',
            file: 'bin/sync.js',
            line: null,
            reason: 'Reads environment variables that may hold tokens.',
          },
          {
            source: 'check',
            severity: 'review',
            rule: 'inline-shell',
            file: 'commands/pull.md',
            line: 3,
            reason: 'Runs a shell command without asking when it loads.',
          },
        ],
      },
    }),
  ];
}

const WARP_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
];

export function warpDetailsFixture(): UserPlugin {
  const script = (event: string) =>
    `scripts/on-${event.replace(/[A-Z]/g, (letter, at: number) => `${at ? '-' : ''}${letter.toLowerCase()}`)}.sh`;
  const hooks = WARP_EVENTS.map((event) => ({
    event,
    matcher: null,
    command: `\${CLAUDE_PLUGIN_ROOT}/${script(event)}`,
  }));
  const scripts = [
    ...WARP_EVENTS.map(script),
    'scripts/notify.sh',
    'scripts/should-use-structured.sh',
    'scripts/build-payload.sh',
  ];
  return plugin({
    key: 'warp@claude-code-warp',
    name: 'warp',
    marketplace: 'claude-code-warp',
    version: '2.1.0',
    description: 'Native Warp notifications when Claude completes tasks or needs input.',
    hooks,
    scan: {
      status: 'review',
      agentReview: 'done',
      agentReviewCost: { tokens: 26_800, usd: 0.08 },
      findings: [
        ...hooks.map((hook) => ({
          source: 'check' as const,
          severity: 'review' as const,
          rule: 'hook',
          title: 'Runs commands on Claude events',
          file: 'hooks/hooks.json',
          line: null,
          reason: `Hook on ${hook.event}: ${hook.command}`,
        })),
        ...scripts.map((file) => ({
          source: 'check' as const,
          severity: 'review' as const,
          rule: 'executable',
          title: 'Scripts and programs it runs',
          file,
          line: null,
          reason: 'A script or program the plugin runs.',
        })),
        {
          source: 'agent',
          severity: 'review',
          rule: 'transcript-content-exfil-to-notifier',
          title: 'Sends parts of your chats to a helper script',
          file: 'scripts/on-stop.sh',
          line: 18,
          reason:
            'Reads the last prompt and reply from the transcript and passes them to the notifier script.',
        },
        {
          source: 'agent',
          severity: 'review',
          rule: 'unquoted-terminal-escape',
          title: 'Writes unchecked text to your terminal',
          file: 'scripts/notify.sh',
          line: 9,
          reason:
            'Writes notification text to the terminal as an escape sequence without escaping it.',
        },
      ],
    },
  });
}

export async function mockPlugins(page: Page, plugins = fixtures()) {
  const puts: { key: string; body: UserPluginUpdate }[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/user-plugins'),
    async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({ json: { plugins } });
        return;
      }
      const key = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() ?? '');
      const body = request.postDataJSON() as UserPluginUpdate;
      puts.push({ key, body });
      const target = plugins.find((item) => item.key === key);
      if (!target) return route.fulfill({ status: 404, json: { error: 'Not found' } });
      if (body.enabled && target.scan.status !== 'clean' && !body.confirmFindings) {
        return route.fulfill({ status: 409, json: { error: 'Confirm the findings first.' } });
      }
      target.enabled = body.enabled;
      await route.fulfill({ json: target });
    },
  );
  return puts;
}

export async function openPlugins(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  const group = page.getByRole('region', { name: 'Plugins' });
  await group.scrollIntoViewIfNeeded();
  return group;
}
