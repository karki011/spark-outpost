import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';
import { agentEnvironment } from './agent-env.ts';
import { codexUserMcpNames } from './codex-mcp.ts';

let home: string;
let codexHome: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'spark-codex-mcp-'));
  codexHome = join(home, 'codex');
  await mkdir(codexHome);
  await writeFile(
    join(codexHome, 'config.toml'),
    '[mcp_servers.github]\ncommand = "gh-mcp"\n\n[mcp_servers."team docs"]\nurl = "https://d/mcp"\n',
  );
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('user-level Codex MCP servers', () => {
  it('lists the names in CODEX_HOME/config.toml, or ~/.codex when CODEX_HOME is unset', async () => {
    expect(await codexUserMcpNames({ CODEX_HOME: codexHome })).toEqual(['github', 'team docs']);
    expect(await codexUserMcpNames({ HOME: home })).toEqual([]);
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'config.toml'), '[mcp_servers.one]\ncommand = "x"\n');
    expect(await codexUserMcpNames({ HOME: home })).toEqual(['one']);
  });

  it('turns every one of them off in CODEX_CONFIG and keeps the log folder unset', async () => {
    const env = await agentEnvironment(
      {
        definition: agentDefinitions.codex,
        env: { PATH: '/bin', CODEX_HOME: codexHome, APP_SERVER_LOGS: join(home, 'logs') },
      },
      home,
    );
    expect(env).not.toHaveProperty('APP_SERVER_LOGS');
    const config = JSON.parse(env.CODEX_CONFIG!) as Record<string, unknown>;
    expect(config.mcp_servers).toEqual({
      github: { enabled: false },
      'team docs': { enabled: false },
    });
    expect(config).toHaveProperty('web_search', 'disabled');
  });

  it('leaves Claude alone', async () => {
    const env = await agentEnvironment(
      { definition: agentDefinitions.claude, env: { PATH: '/bin', CODEX_HOME: codexHome } },
      home,
    );
    expect(env).toEqual({ PATH: '/bin', CODEX_HOME: codexHome });
  });
});
