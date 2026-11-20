import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mcpServersDelivery } from '@agentclientprotocol/claude-agent-acp/dist/claude-cli.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const adapterAgent = createRequire(import.meta.url).resolve(
  '@agentclientprotocol/claude-agent-acp/dist/v1/acp-agent.js',
);

function queryOptionsSource(): string {
  const source = readFileSync(adapterAgent, 'utf8');
  const start = source.indexOf('mcpServersDelivery: mcpServersDelivery()');
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('pathToClaudeCodeExecutable', start));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Claude adapter's MCP server delivery", () => {
  it('puts the servers on the command line for a CLI Spark names, so Spark must ask for stdin', () => {
    vi.stubEnv('CLAUDE_CODE_EXECUTABLE', '/usr/local/bin/claude');
    expect(mcpServersDelivery()).toBe('argv');
  });

  it("lets the client's own mcpServersDelivery option win over its choice", () => {
    const options = queryOptionsSource();
    expect(options.indexOf('...userProvidedOptions,')).toBeGreaterThan(0);
  });
});
