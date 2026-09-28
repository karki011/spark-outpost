import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanHomesAt, scanUserMcp, type UserMcpScan } from './scan.ts';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'spark-mcp-scan-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function put(path: string, text: string) {
  const full = join(home, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
}

const marker = () => join(home, 'ran');
const trap = () => ({ command: 'sh', args: ['-c', `touch ${marker()}`] });

function byTool(scan: UserMcpScan, tool: string) {
  return scan.servers.filter((entry) => entry.tool === tool).map((entry) => entry.server);
}

describe('scanning other apps for MCP servers', () => {
  it('reads Claude Code global and per-project servers as user-level entries', async () => {
    await put(
      '.claude.json',
      JSON.stringify({
        mcpServers: {
          github: { ...trap(), env: { GITHUB_TOKEN: 'ghp_secret' } },
          docs: { type: 'http', url: 'https://docs.example/mcp', headers: { 'X-Key': 'k1' } },
        },
        projects: {
          '/work/app': { mcpServers: { github: trap(), db: trap() } },
        },
      }),
    );
    const scan = await scanUserMcp(scanHomesAt(home));
    const servers = byTool(scan, 'claude-code');
    expect(servers.map((server) => server.name)).toEqual(['github', 'docs', 'github-app', 'db']);
    expect(servers[0]).toMatchObject({ transport: 'stdio', command: 'sh' });
    expect(servers[0]!.env).toEqual({ GITHUB_TOKEN: 'ghp_secret' });
    expect(servers[1]).toMatchObject({ transport: 'http', url: 'https://docs.example/mcp' });
    expect(scan.servers.every((entry) => entry.origin === join(home, '.claude.json'))).toBe(true);
    expect(existsSync(marker())).toBe(false);
  });

  it('reads Claude Desktop, Cursor and Windsurf mcpServers', async () => {
    const desktop = 'Library/Application Support/Claude/claude_desktop_config.json';
    await put(desktop, JSON.stringify({ mcpServers: { files: trap() } }));
    await put(
      '.cursor/mcp.json',
      JSON.stringify({ mcpServers: { linear: { url: 'https://l/sse', type: 'sse' } } }),
    );
    await put(
      '.codeium/windsurf/mcp_config.json',
      JSON.stringify({ mcpServers: { remote: { serverUrl: 'https://w/mcp' } } }),
    );
    const scan = await scanUserMcp(scanHomesAt(home));
    expect(byTool(scan, 'claude-desktop').map((server) => server.name)).toEqual(['files']);
    expect(byTool(scan, 'cursor')[0]).toMatchObject({ transport: 'sse', url: 'https://l/sse' });
    expect(byTool(scan, 'windsurf')[0]).toMatchObject({ transport: 'http', url: 'https://w/mcp' });
    expect(existsSync(marker())).toBe(false);
  });

  it('reads VS Code mcp.json and settings.json with comments and trailing commas', async () => {
    const user = 'Library/Application Support/Code/User';
    await put(
      `${user}/mcp.json`,
      `{
        // my servers
        "servers": {
          "playwright": { "type": "stdio", "command": "npx", "args": ["@playwright/mcp"], },
        },
        "inputs": [],
      }`,
    );
    await put(
      `${user}/settings.json`,
      `{ "editor.tabSize": 2, /* block */ "mcp": { "servers": { "http-one": { "type": "http", "url": "https://h/mcp" } } } }`,
    );
    const scan = await scanUserMcp(scanHomesAt(home));
    expect(byTool(scan, 'vscode').map((server) => [server.name, server.transport])).toEqual([
      ['playwright', 'stdio'],
      ['http-one', 'http'],
    ]);
  });

  it('reads Codex [mcp_servers.*] including bearer and env headers', async () => {
    await put(
      '.codex/config.toml',
      `model = "gpt"
[mcp_servers.github]
command = "sh"
args = ["-c", "touch ${marker()}"]
env = { GITHUB_TOKEN = "ghp_x" }

[mcp_servers.remote]
url = "https://r/mcp"
bearer_token_env_var = "REMOTE_TOKEN"
env_http_headers = { "X-Team" = "TEAM_ID" }
http_headers = { "X-Static" = "yes" }
`,
    );
    const scan = await scanUserMcp(scanHomesAt(home));
    const [github, remote] = byTool(scan, 'codex');
    expect(github).toMatchObject({
      transport: 'stdio',
      command: 'sh',
      env: { GITHUB_TOKEN: 'ghp_x' },
    });
    expect(remote).toMatchObject({ transport: 'http', url: 'https://r/mcp' });
    expect(remote!.headers).toEqual({
      'X-Static': 'yes',
      'X-Team': '${TEAM_ID}',
      Authorization: 'Bearer ${REMOTE_TOKEN}',
    });
    expect(existsSync(marker())).toBe(false);
  });

  it('reports missing files, bad files and entries without a command or URL', async () => {
    await put('.cursor/mcp.json', '{ not json');
    await put('.codex/config.toml', '[mcp_servers.broken\n');
    await put('.claude.json', JSON.stringify({ mcpServers: { empty: {} } }));
    const scan = await scanUserMcp(scanHomesAt(home));
    const source = (tool: string) => scan.sources.find((entry) => entry.tool === tool)!;
    expect(source('claude-desktop')).toMatchObject({ found: false, servers: 0 });
    expect(source('cursor').warnings).toEqual([
      '~/.cursor/mcp.json is not valid JSON, so it was skipped.',
    ]);
    expect(source('codex').warnings).toEqual([
      'Codex config.toml is not valid TOML, so it was skipped.',
    ]);
    expect(source('claude-code').warnings[0]).toContain('"empty" has no command or URL');
    expect(scan.servers).toEqual([]);
  });
});
