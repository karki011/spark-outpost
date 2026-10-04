import { describe, expect, it } from 'vitest';
import { checkedMcpConfig, valueNames, type McpConfigFields } from './mcp-config.ts';

const stdio = (overrides: Partial<McpConfigFields> = {}): McpConfigFields => ({
  name: 'files',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/notes'],
  url: null,
  envNames: [],
  headerNames: [],
  ...overrides,
});

const http = (overrides: Partial<McpConfigFields> = {}): McpConfigFields => ({
  name: 'docs',
  transport: 'http',
  command: null,
  args: [],
  url: 'https://mcp.example.com/v1',
  envNames: [],
  headerNames: ['Authorization'],
  ...overrides,
});

describe('checkedMcpConfig', () => {
  it('keeps a stdio command with its arguments and drops URL and headers', () => {
    const config = checkedMcpConfig(
      stdio({ envNames: ['API_KEY', 'API_KEY', 'REGION'], headerNames: ['X'], url: 'https://x' }),
    );
    expect(config).toEqual({
      name: 'files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/notes'],
      url: null,
      envNames: ['API_KEY', 'REGION'],
      headerNames: [],
    });
    expect(valueNames(config)).toEqual(['API_KEY', 'REGION']);
  });

  it('keeps an HTTP URL with its header names and drops the command', () => {
    const config = checkedMcpConfig(http({ command: 'npx', args: ['x'], envNames: ['A'] }));
    expect(config).toMatchObject({
      command: null,
      args: [],
      envNames: [],
      url: expect.any(String),
    });
    expect(valueNames(config)).toEqual(['Authorization']);
  });

  it.each([
    ['a bad name', stdio({ name: 'my server' }), 'letters, numbers'],
    ['a missing command', stdio({ command: null }), 'needs a command'],
    ['a command line in command', stdio({ command: 'npx -y server' }), 'each argument in args'],
    ['a newline in an argument', stdio({ args: ['a\nrm -rf /'] }), 'single-line'],
    ['a missing URL', http({ url: null }), 'http:// or https://'],
    ['a file URL', http({ url: 'file:///etc/passwd' }), 'http:// or https://'],
  ])('refuses %s', (_label, fields, message) => {
    expect(() => checkedMcpConfig(fields)).toThrow(message);
  });

  it('allows an absolute program path with spaces', () => {
    const command = '/Applications/My Tools/bin/server';
    expect(checkedMcpConfig(stdio({ command, args: [] })).command).toBe(command);
  });

  it.each([
    ['a token flag', stdio({ args: ['--token=abc12345xyz'] })],
    ['a secret flag and its value', stdio({ args: ['--api-key', 'abc12345xyz'] })],
    ['an inline assignment', stdio({ args: ['GITHUB_TOKEN=abc12345xyz'] })],
    ['a provider key in an argument', stdio({ args: ['sk-ant-api03-' + 'a'.repeat(40)] })],
    ['credentials in the URL', http({ url: 'https://user:hunter22222@mcp.example.com/' })],
    ['a key in the query', http({ url: 'https://mcp.example.com/?api_key=abc12345xyz' })],
  ])('refuses %s and points to named placeholders', (_label, fields) => {
    expect(() => checkedMcpConfig(fields)).toThrow(/looks like it holds a secret.*NAME/);
  });
});
