import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { cliEnvironment } from './agent-cli.ts';

describe('agent CLI location', () => {
  it('points each adapter at the CLI found on the user machine', async () => {
    const asked: string[] = [];
    const locate = async (cli: string) => {
      asked.push(cli);
      return `/Users/me/.local/bin/${cli}`;
    };
    expect(await cliEnvironment(agentDefinitions.claude, locate)).toEqual({
      CLAUDE_CODE_EXECUTABLE: '/Users/me/.local/bin/claude',
    });
    expect(await cliEnvironment(agentDefinitions.codex, locate)).toEqual({
      CODEX_PATH: '/Users/me/.local/bin/codex',
    });
    expect(await cliEnvironment(agentDefinitions.zai, locate)).toEqual({
      CLAUDE_CODE_EXECUTABLE: '/Users/me/.local/bin/claude',
    });
    expect(asked).toEqual(['claude', 'codex', 'claude']);
  });

  it('refuses to start without the CLI instead of falling back to a bundled one', async () => {
    const missing = cliEnvironment(agentDefinitions.zai, async () => null);
    await expect(missing).rejects.toBeInstanceOf(ProviderError);
    await expect(missing).rejects.toThrow(
      "Z.ai (GLM) runs through the `claude` CLI, which isn't installed or isn't on your PATH.",
    );
  });
});
