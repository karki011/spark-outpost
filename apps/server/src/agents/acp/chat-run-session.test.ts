import { describe, expect, it } from 'vitest';
import type { PathPolicy } from '../../projects/path-policy.ts';
import { NO_PUSH_URL, agentEnvironment } from './agent-env.ts';
import {
  CHAT_RUN_DENY_RULES,
  FORCE_PUSH_DENY_RULES,
  GIT_CONFIG_ASK_RULE,
  PUBLISH_ASK_RULES,
  agentDefinitions,
} from './agents.ts';
import { sessionMeta } from './session-start.ts';

const project = { roots: [{ path: '/work/app', ignore: [] }] } as unknown as PathPolicy;
const { claude } = agentDefinitions;

interface Permissions {
  ask?: string[];
  deny: string[];
}

function permissionsOf(meta: Record<string, unknown> | null): Permissions {
  const shaped = meta as {
    claudeCode: { options: { settings: { permissions: Permissions } } };
  };
  return shaped.claudeCode.options.settings.permissions;
}

describe("a Claude session for the chat's own changing run", () => {
  it('sends git push and gh to the approval gate, after the safety floor rules', () => {
    const permissions = permissionsOf(
      sessionMeta(claude, project, true, null, { changesProject: true }),
    );
    const commands = (permissions.ask ?? []).filter((rule) => rule.startsWith('Bash('));
    expect(commands).toEqual([GIT_CONFIG_ASK_RULE, ...PUBLISH_ASK_RULES]);
  });

  it('never denies gh or a plain push outright, so reads through gh reach the gate', () => {
    const { deny } = permissionsOf(
      sessionMeta(claude, project, true, null, { changesProject: true }),
    );
    expect(deny).not.toContain('Bash(gh:*)');
    expect(deny).not.toContain('Bash(git push:*)');
    expect(deny).toEqual(expect.arrayContaining([...CHAT_RUN_DENY_RULES]));
  });

  it('denies force pushes, remote changes and hosting CLIs other than gh', () => {
    const { deny } = permissionsOf(
      sessionMeta(claude, project, true, null, { changesProject: true }),
    );
    expect(deny).toEqual(expect.arrayContaining(FORCE_PUSH_DENY_RULES));
    for (const rule of [
      'Bash(git remote add:*)',
      'Bash(git remote set-url:*)',
      'Bash(git send-email:*)',
      'Bash(hub:*)',
      'Bash(glab:*)',
    ]) {
      expect(deny).toContain(rule);
    }
  });

  it('adds no publish ask rules to a question, a chat without a project or a run without the flag', () => {
    const question = sessionMeta(claude, project, false, null, { changesProject: true });
    const noProject = sessionMeta(claude, null, true, null, { changesProject: true });
    const plain = sessionMeta(claude, project, true, null, {});
    for (const meta of [question, noProject, plain]) {
      const asks = permissionsOf(meta).ask ?? [];
      for (const rule of PUBLISH_ASK_RULES) expect(asks).not.toContain(rule);
    }
  });
});

describe("the agent process of the chat's own changing run that may not publish", () => {
  const options = {
    definition: claude,
    env: { PATH: '/bin', GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'ghp_y' },
  };

  it('points pushes nowhere and keeps the gh sign-in, so gh reads and git fetch work', async () => {
    expect(await agentEnvironment(options, '/runs/1', false, null, true)).toEqual({
      PATH: '/bin',
      GH_TOKEN: 'ghp_x',
      GITHUB_TOKEN: 'ghp_y',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${NO_PUSH_URL}.pushInsteadOf`,
      GIT_CONFIG_VALUE_0: '',
    });
  });

  it('is left alone without the flag', async () => {
    expect(await agentEnvironment(options, '/runs/1')).toEqual(options.env);
  });
});
