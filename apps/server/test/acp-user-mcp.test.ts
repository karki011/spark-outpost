import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepoScanner, type RepoScan } from '../src/agent-config/discovery.ts';
import { rootLaunch } from '../src/agent-config/launch.ts';
import { DEFAULT_AGENT_SETTINGS } from '../src/agent-config/store.ts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions, type AgentDefinition } from '../src/agents/acp/agents.ts';
import type { UserMcpLaunch } from '../src/mcp/launch.ts';
import type { ProviderOutput, ProviderTurn } from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { makeConfiguredRepo } from './repo-config-fixture.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const claude: AgentDefinition = { ...agentDefinitions.claude, conversationMode: 'read-only' };

const GITHUB_ID = '00000000-0000-4000-8000-0000000000a1';
const DOCS_ID = '00000000-0000-4000-8000-0000000000a2';

const github: UserMcpLaunch = {
  id: GITHUB_ID,
  name: 'github',
  transport: 'stdio',
  command: 'gh-mcp',
  args: ['--stdio'],
  url: null,
  envNames: ['GITHUB_TOKEN'],
  headerNames: [],
  fingerprint: 'fp-gh',
};
const docs: UserMcpLaunch = {
  ...github,
  id: DOCS_ID,
  name: 'docs',
  transport: 'http',
  command: null,
  args: [],
  url: 'https://docs.example/mcp',
  envNames: [],
  headerNames: ['Authorization'],
};

const secrets = memorySecretStore({
  [`mcp:${GITHUB_ID}`]: JSON.stringify({ env: { GITHUB_TOKEN: 'ghp_from_keychain' } }),
  [`mcp:${DOCS_ID}`]: JSON.stringify({ headers: { Authorization: 'Bearer docs-token' } }),
});

let base: string;
let root: string;
let codexHome: string;
let scan: RepoScan;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-user-mcp-')));
  root = join(base, 'app');
  codexHome = join(base, 'codex-home');
  await mkdir(root);
  await mkdir(codexHome);
  await writeFile(
    join(codexHome, 'config.toml'),
    '[mcp_servers.github]\ncommand = "their-gh"\n\n[mcp_servers.notes]\ncommand = "notes"\n',
  );
  await makeConfiguredRepo(root);
  scan = await createRepoScanner().scan(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

interface Received {
  meta: { claudeCode: { options: { settings: { permissions: { ask?: string[] } } } } } | null;
  mcpServers: {
    name: string;
    env?: { name: string; value: string }[];
    headers?: { name: string; value: string }[];
  }[];
  codexConfig: string | null;
}

async function session(definition: AgentDefinition, extra: Partial<ProviderTurn>) {
  const env = {
    ...childEnvironment(process.env),
    FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }),
    CODEX_HOME: codexHome,
  };
  const provider = createAcpProvider({ definition, launch, cancelGraceMs: 2_000, env, secrets });
  const outputs: ProviderOutput[] = [];
  for await (const output of provider.run({
    prompt: '#session',
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    ...extra,
  })) {
    outputs.push(output);
  }
  const text = replyText(outputs);
  return JSON.parse(text.slice(text.indexOf('session=') + 'session='.length)) as Received;
}

const echoEnabled = () => {
  const echo = scan.mcpServers.find((server) => server.name === 'echo')!;
  return new Map([[echo.name, echo.fingerprint]]);
};

describe('user-level MCP servers reach the agent', { timeout: 20_000 }, () => {
  it('sends enabled user servers with keychain values next to the repo’s, and leaves their tools to the agent’s mode', async () => {
    const repo = [await rootLaunch(scan, DEFAULT_AGENT_SETTINGS, echoEnabled())];
    const received = await session(claude, {
      projectRoots: [root],
      repo,
      userMcp: [github, docs],
    });
    expect(received.mcpServers.map((server) => server.name)).toEqual(['github', 'docs', 'echo']);
    expect(received.mcpServers[0]!.env).toEqual([
      { name: 'GITHUB_TOKEN', value: 'ghp_from_keychain' },
    ]);
    expect(received.mcpServers[1]!.headers).toEqual([
      { name: 'Authorization', value: 'Bearer docs-token' },
    ]);
    expect(received.meta!.claudeCode.options.settings.permissions).not.toHaveProperty('ask');
  });

  it('sends user servers in a chat without a project', async () => {
    const received = await session(claude, { userMcp: [github] });
    expect(received.mcpServers.map((server) => server.name)).toEqual(['github']);
  });

  it('keeps Codex’s own config.toml servers off and renames ours when a name clashes', async () => {
    const received = await session(agentDefinitions.codex, {
      projectRoots: [root],
      repo: [await rootLaunch(scan, DEFAULT_AGENT_SETTINGS, new Map())],
      userMcp: [github],
    });
    expect(JSON.parse(received.codexConfig!)).toMatchObject({
      mcp_servers: { github: { enabled: false }, notes: { enabled: false } },
    });
    expect(received.mcpServers.map((server) => server.name)).toEqual(['github_spark']);
  });
});
