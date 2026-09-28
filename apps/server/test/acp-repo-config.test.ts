import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepoScanner, type RepoScan } from '../src/agent-config/discovery.ts';
import { rootLaunch, type RepoLaunch } from '../src/agent-config/launch.ts';
import { DEFAULT_AGENT_SETTINGS } from '../src/agent-config/store.ts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import {
  agentDefinitions,
  BUILDER_PUBLISH_DENY_RULES,
  type AgentDefinition,
} from '../src/agents/acp/agents.ts';
import type { ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { FIXTURE_RULE, makeConfiguredRepo } from './repo-config-fixture.ts';

const launch = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, 'fake-acp-agent.ts')],
};
const env = {
  ...childEnvironment(process.env),
  FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }),
  CODEX_HOME: join(tmpdir(), 'spark-no-codex-home'),
};
const claude: AgentDefinition = { ...agentDefinitions.claude, conversationMode: 'read-only' };
const provider = (definition: AgentDefinition) =>
  createAcpProvider({ definition, launch, cancelGraceMs: 2_000, env });

let base: string;
let root: string;
let scan: RepoScan;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-repo-')));
  root = join(base, 'app');
  await mkdir(root);
  await makeConfiguredRepo(root);
  scan = await createRepoScanner().scan(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

interface Received {
  meta: {
    systemPrompt?: { append: string };
    claudeCode: { options: Record<string, unknown> & { settings: Record<string, unknown> } };
  } | null;
  mcpServers: { name: string }[];
  codexConfig: string | null;
}

async function session(
  definition: AgentDefinition,
  repo: RepoLaunch,
  extra: Partial<ProviderTurn> = {},
) {
  const outputs: ProviderOutput[] = [];
  for await (const output of provider(definition).run({
    ...extra,
    prompt: '#session',
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    projectRoots: [root],
    signal: new AbortController().signal,
    repo,
  })) {
    outputs.push(output);
  }
  const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
  const received = JSON.parse(text.slice(text.indexOf('session=') + 'session='.length)) as Received;
  const following = outputs.find((output) => output.kind === 'instructions');
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return { received, following, steps };
}

const enabled = () =>
  new Map(scan.mcpServers.filter((s) => s.name !== 'remote').map((s) => [s.name, s.fingerprint]));

describe('repo agent config reaches the agent over ACP', { timeout: 20_000 }, () => {
  it('sends Claude the instructions, plugin, hooks-off flag and only enabled MCP servers', async () => {
    const repo = [await rootLaunch(scan, DEFAULT_AGENT_SETTINGS, enabled())];
    const { received, following, steps } = await session(claude, repo);
    expect(received.meta?.systemPrompt?.append).toContain(FIXTURE_RULE);
    const options = received.meta!.claudeCode.options;
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settings).toMatchObject({
      disableAllHooks: true,
      disableSkillShellExecution: true,
    });
    expect(options.plugins).toEqual([{ type: 'local', path: expect.any(String) }]);
    expect(received.mcpServers.map((server) => server.name)).toEqual(['echo']);
    expect(steps).toContain("Claude can't use the SSE MCP server stream; skipped it");
    expect(following).toEqual({
      kind: 'instructions',
      files: [
        'CLAUDE.md',
        'CLAUDE.local.md',
        'AGENTS.md',
        '.cursorrules',
        '.github/copilot-instructions.md',
        '.cursor/rules/style.mdc',
      ],
    });
  });

  it('denies pushing, gh and remote changes to a Builder session, not to other Do sessions', async () => {
    const repo = [await rootLaunch(scan, DEFAULT_AGENT_SETTINGS, enabled())];
    const approvals = {
      review: async () => ({ outcome: 'cancelled' as const, note: 'not used' }),
    };
    const denied = async (builder: boolean) => {
      const { received } = await session(claude, repo, { mode: 'do', approvals, builder });
      const settings = received.meta!.claudeCode.options.settings as {
        permissions: { deny: string[] };
      };
      return settings.permissions.deny;
    };
    expect(await denied(true)).toEqual(expect.arrayContaining([...BUILDER_PUBLISH_DENY_RULES]));
    expect(await denied(false)).not.toContain('Bash(git push:*)');
  });

  it('passes approved hooks through and sends nothing extra when all switches are off', async () => {
    const hooksOn = [
      await rootLaunch(
        scan,
        { ...DEFAULT_AGENT_SETTINGS, hooksFingerprint: scan.hooksFingerprint },
        new Map(),
      ),
    ];
    const on = await session(claude, hooksOn);
    expect(on.received.meta!.claudeCode.options.settings).toHaveProperty('hooks.Stop');
    expect(on.received.meta!.claudeCode.options.settings).not.toHaveProperty('disableAllHooks');
    const off = {
      instructions: false,
      skills: false,
      commands: false,
      subagents: false,
      hooksFingerprint: null,
    };
    const quiet = await session(claude, [await rootLaunch(scan, off, new Map())]);
    expect(quiet.received.meta).not.toHaveProperty('systemPrompt');
    expect(quiet.received.meta!.claudeCode.options).not.toHaveProperty('plugins');
    expect(quiet.received.mcpServers).toEqual([]);
    expect(quiet.following).toEqual({ kind: 'instructions', files: [] });
  });

  it('configures Codex through CODEX_CONFIG and ACP mcpServers', async () => {
    const repo = [
      await rootLaunch(scan, { ...DEFAULT_AGENT_SETTINGS, instructions: false }, enabled()),
    ];
    const { received } = await session(agentDefinitions.codex, repo);
    expect(received.meta).toBeNull();
    expect(JSON.parse(received.codexConfig ?? '{}')).toMatchObject({ project_doc_max_bytes: 0 });
    expect(received.mcpServers.map((server) => server.name)).toEqual(['echo']);
  });
});
