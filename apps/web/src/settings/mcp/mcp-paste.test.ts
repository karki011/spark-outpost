import { describe, expect, it } from 'vitest';
import { parsePastedServer } from './mcp-paste.ts';

describe('parsePastedServer', () => {
  it('reads the first server from an mcpServers block', () => {
    const text = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github', 'a b'],
          env: { GITHUB_TOKEN: 'secret', COUNT: 3 },
        },
      },
    });
    expect(parsePastedServer(text)).toEqual({
      ok: true,
      server: {
        name: 'github',
        transport: 'stdio',
        commandLine: `npx -y @modelcontextprotocol/server-github 'a b'`,
        url: '',
        values: [{ name: 'GITHUB_TOKEN', value: 'secret' }],
      },
    });
  });

  it('accepts a bare named entry and a remote server with headers', () => {
    const text = `"docs": { "type": "sse", "url": "https://example.com/sse", "headers": { "Authorization": "Bearer x" } }`;
    expect(parsePastedServer(text)).toEqual({
      ok: true,
      server: {
        name: 'docs',
        transport: 'sse',
        commandLine: '',
        url: 'https://example.com/sse',
        values: [{ name: 'Authorization', value: 'Bearer x' }],
      },
    });
  });

  it('accepts a single unnamed server object', () => {
    const result = parsePastedServer('{"command":"uvx","args":["mcp-server-time"]}');
    expect(result).toMatchObject({
      ok: true,
      server: { name: null, commandLine: 'uvx mcp-server-time' },
    });
  });

  it('explains what is wrong with other input', () => {
    expect(parsePastedServer('not json')).toEqual({
      ok: false,
      error: 'Paste the JSON from the server’s README.',
    });
    expect(parsePastedServer('{"mcpServers":{}}')).toEqual({
      ok: false,
      error: 'No server with a command or URL in that JSON.',
    });
  });
});
