import { describe, expect, it } from 'vitest';
import { agentEnvironment } from './agent-env.ts';
import { agentDefinitions } from './agents.ts';
import { withBackgroundSubagents } from './subagent-env.ts';

const inherited = { PATH: '/bin', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' };

describe('how a chat session is told to run sub-agents', () => {
  it('turns on background sub-agents for Claude and drops a setting that forces foreground', async () => {
    const env = await agentEnvironment(
      { definition: agentDefinitions.claude, env: inherited },
      '/runs/1',
    );
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CODE_FORK_SUBAGENT: '1' });
  });

  it('does the same for Z.ai, which runs through the same CLI', () => {
    expect(withBackgroundSubagents(agentDefinitions.zai, inherited)).toEqual({
      PATH: '/bin',
      CLAUDE_CODE_FORK_SUBAGENT: '1',
    });
  });

  it('leaves the Codex environment alone', () => {
    expect(withBackgroundSubagents(agentDefinitions.codex, inherited)).toBe(inherited);
  });
});
