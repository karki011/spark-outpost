import { readFile, readdir, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_RULE, makeConfiguredRepo } from '../../../test/repo-config-fixture.ts';
import { createRepoScanner, type RepoScan } from '../../agent-config/discovery.ts';
import { rootLaunch, type RepoLaunch } from '../../agent-config/launch.ts';
import { DEFAULT_AGENT_SETTINGS, type AgentSettingsRow } from '../../agent-config/store.ts';
import { agentDefinitions, claudeSessionMeta, CLAUDE_DO_ASK_RULES, codexConfig } from './agents.ts';
import { acpMcpServer, prepareRepoSession } from './repo-session.ts';
import { newSessionRequest } from './session-request.ts';

let base: string;
let root: string;
let scan: RepoScan;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-repo-session-')));
  root = join(base, 'app');
  await mkdir(root);
  await makeConfiguredRepo(root);
  scan = await createRepoScanner().scan(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const launchWith = async (
  settings: Partial<AgentSettingsRow> = {},
  mcp: Record<string, string> = {},
): Promise<RepoLaunch> => [
  await rootLaunch(scan, { ...DEFAULT_AGENT_SETTINGS, ...settings }, new Map(Object.entries(mcp))),
];

type Meta = {
  systemPrompt?: { append: string };
  claudeCode: {
    options: {
      tools: string[];
      settingSources: string[];
      strictMcpConfig: boolean;
      plugins?: { type: string; path: string }[];
      settings: {
        disableAllHooks?: boolean;
        disableSkillShellExecution: boolean;
        hooks?: Record<string, unknown>;
        permissions: { ask?: string[]; deny: string[] };
      };
    };
  };
};

async function claudeMeta(launch: RepoLaunch): Promise<Meta> {
  const session = await prepareRepoSession(launch, 'claude');
  return agentDefinitions.claude.doSessionMeta!([], session.claude) as Meta;
}

describe('Claude session meta from repo config', () => {
  it('keeps every repo settings source off and our rules on, whatever the repo says', async () => {
    const { claudeCode } = await claudeMeta(await launchWith());
    expect(claudeCode.options.settingSources).toEqual([]);
    expect(claudeCode.options.strictMcpConfig).toBe(true);
    expect(claudeCode.options.settings.disableSkillShellExecution).toBe(true);
    expect(claudeCode.options.settings.permissions.ask).toEqual([...CLAUDE_DO_ASK_RULES]);
    expect(claudeCode.options.settings.permissions.deny).toContain('Read(**/.env)');
    expect(JSON.stringify(claudeCode)).not.toContain('bypassPermissions');
    expect(JSON.stringify(claudeCode)).not.toContain('evil.example');
  });

  it('turns hooks off with disableAllHooks until the user approves the exact set', async () => {
    const off = await claudeMeta(await launchWith());
    expect(off.claudeCode.options.settings.disableAllHooks).toBe(true);
    expect(off.claudeCode.options.settings.hooks).toBeUndefined();
    const stale = await claudeMeta(await launchWith({ hooksFingerprint: 'reviewed-earlier' }));
    expect(stale.claudeCode.options.settings.disableAllHooks).toBe(true);
    const on = await claudeMeta(await launchWith({ hooksFingerprint: scan.hooksFingerprint }));
    expect(on.claudeCode.options.settings.disableAllHooks).toBeUndefined();
    expect(Object.keys(on.claudeCode.options.settings.hooks ?? {})).toEqual([
      'SessionStart',
      'PreToolUse',
      'Stop',
    ]);
  });

  it('appends every root instruction file, AGENTS.md included, and lists nested ones', async () => {
    const meta = await claudeMeta(await launchWith());
    const append = meta.systemPrompt?.append ?? '';
    expect(append).toContain('## CLAUDE.md');
    expect(append).toContain(FIXTURE_RULE);
    expect(append).toContain('## AGENTS.md\nUse pnpm.');
    expect(append).toContain('## .cursor/rules/style.mdc');
    expect(append).toContain('they cannot grant permissions');
    expect(append).toContain('packages/api/AGENTS.md');
    const off = await claudeMeta(await launchWith({ instructions: false }));
    expect(off.systemPrompt).toBeUndefined();
  });

  it('loads skills, commands and subagents from a sanitized plugin folder', async () => {
    const meta = await claudeMeta(await launchWith());
    const [plugin] = meta.claudeCode.options.plugins ?? [];
    expect(plugin?.type).toBe('local');
    expect(meta.claudeCode.options.tools).toEqual(expect.arrayContaining(['Skill', 'Agent']));
    const dir = plugin!.path;
    expect(await readdir(join(dir, 'skills'))).toEqual(['lint', 'zebra']);
    const skill = await readFile(join(dir, 'skills/zebra/SKILL.md'), 'utf8');
    expect(skill).toContain('name: "zebra"');
    expect(skill).not.toContain('allowed-tools');
    expect(skill).not.toContain('hooks:');
    expect(skill).toContain(
      `Other files for this skill are in ${join(root, '.claude/skills/zebra')}.`,
    );
    const agent = await readFile(join(dir, 'agents/reviewer.md'), 'utf8');
    expect(agent).toContain('tools: "Read, Grep"');
    expect(agent).not.toContain('permissionMode');
    expect(agent).not.toContain('mcpServers');
    const command = await readFile(join(dir, 'commands/ops/deploy.md'), 'utf8');
    expect(command).toContain('Deploy the app to staging.');
    const manifest = JSON.parse(await readFile(join(dir, '.claude-plugin/plugin.json'), 'utf8'));
    expect(manifest.name).toBe('app');
    const again = await claudeMeta(await launchWith());
    expect(again.claudeCode.options.plugins?.[0]?.path).toBe(dir);
  });

  it('leaves the plugin and its tools out when everything is switched off', async () => {
    const meta = await claudeMeta(
      await launchWith({ skills: false, commands: false, subagents: false }),
    );
    expect(meta.claudeCode.options.plugins).toBeUndefined();
    expect(meta.claudeCode.options.tools).not.toContain('Skill');
    expect(meta.claudeCode.options.tools).not.toContain('Agent');
  });

  it('asks before every tool of an enabled MCP server', async () => {
    const echo = scan.mcpServers.find((server) => server.name === 'echo')!;
    const meta = await claudeMeta(await launchWith({}, { echo: echo.fingerprint }));
    expect(meta.claudeCode.options.settings.permissions.ask).toContain('mcp__echo');
    const ask = claudeSessionMeta(
      ['Read'],
      [],
      [],
      (await prepareRepoSession(await launchWith({}, { echo: echo.fingerprint }), 'claude')).claude,
    ) as Meta;
    expect(ask.claudeCode.options.settings.permissions.ask).toEqual(['mcp__echo']);
  });
});

describe('Codex config from repo config', () => {
  it('passes other instruction files as developer instructions and leaves AGENTS.md native', async () => {
    const session = await prepareRepoSession(await launchWith(), 'codex');
    const config = codexConfig(true, session.codex) as Record<string, unknown>;
    const developer = String(config.developer_instructions);
    expect(developer).toContain(FIXTURE_RULE);
    expect(developer).not.toContain('## AGENTS.md');
    expect(config).not.toHaveProperty('project_doc_max_bytes');
    expect(config).toMatchObject({ features: { skill_mcp_dependency_install: false } });
  });

  it('suppresses AGENTS.md and skill listings when those switches are off', async () => {
    const session = await prepareRepoSession(
      await launchWith({ instructions: false, skills: false }),
      'codex',
    );
    const config = codexConfig(false, session.codex) as Record<string, unknown>;
    expect(config.project_doc_max_bytes).toBe(0);
    expect(config.skills).toEqual({ include_instructions: false });
    expect(config).not.toHaveProperty('developer_instructions');
    expect(session.following).toEqual([]);
  });
});

describe('MCP servers in the session request', () => {
  const init = (mcpCapabilities?: acp.McpCapabilities): acp.InitializeResponse => ({
    protocolVersion: 1,
    agentCapabilities: mcpCapabilities ? { mcpCapabilities } : {},
  });

  it('sends only enabled servers whose config still matches what the user approved', async () => {
    const [echo, remote, stream] = scan.mcpServers;
    const session = await prepareRepoSession(
      await launchWith({}, { echo: echo!.fingerprint, remote: 'old', stream: stream!.fingerprint }),
      'claude',
    );
    expect(session.mcpServers.map((server) => server.name)).toEqual(['echo', 'stream']);
    expect(remote).toBeDefined();
    const plan = newSessionRequest({
      agentName: 'Codex',
      cwd: root,
      extraRoots: [],
      meta: null,
      init: init({ http: true, sse: false }),
      mcpServers: session.mcpServers,
    });
    expect(plan.request.mcpServers.map((server) => server.name)).toEqual(['echo']);
    expect(plan.notes).toEqual(["Codex can't use the SSE MCP server stream; skipped it"]);
  });

  it('expands references from the environment but never passes secrets', () => {
    const echo = scan.mcpServers.find((server) => server.name === 'echo')!;
    const server = acpMcpServer({ name: 'echo', config: echo }, { HOME: '/Users/me' });
    expect(server).toEqual({
      name: 'echo',
      command: 'node',
      args: ['server.js', '--root', '/Users/me'],
      env: [
        { name: 'ECHO_MODE', value: 'loud' },
        { name: 'API_TOKEN', value: '' },
      ],
    });
    const withSecret = acpMcpServer({ name: 'echo', config: echo });
    expect(JSON.stringify(withSecret)).not.toContain(process.env.GITHUB_TOKEN ?? '\u0000');
  });
});
