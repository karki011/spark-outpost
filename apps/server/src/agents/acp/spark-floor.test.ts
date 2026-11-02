import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderTurn } from '../../providers/provider.ts';
import {
  RECOMMENDED_RULES,
  recommendedRulesText,
  userRules,
} from '../../spark-rules/recommended.ts';
import { RECOMMENDED_FLOOR, sparkFloor } from '../../spark-rules/floor-flags.ts';
import {
  agentDefinitions,
  CHAT_RUN_DENY_RULES,
  claudeSessionMeta,
  codexConfig,
  FORCE_PUSH_DENY_RULES,
  GIT_CONFIG_ASK_RULE,
} from './agents.ts';
import {
  browserDataDir,
  browserDataRules,
  sparkRulesFlagRules,
} from '../../approvals/browser-data.ts';
import { CLAUDE_DO_TOOLS } from './claude-tools.ts';
import { withSparkFloor } from './repo-session.ts';
import { discardScratch, planLaunch } from './turn-launch.ts';

interface Permissions {
  deny: string[];
  ask?: string[];
}

function permissionsOf(meta: Record<string, unknown>): Permissions {
  const claudeCode = meta.claudeCode as { options: { settings: { permissions: Permissions } } };
  return claudeCode.options.settings.permissions;
}

function floorFrom(lists: { allow?: string[]; ask?: string[]; deny?: string[] }) {
  return sparkFloor(userRules(JSON.stringify({ permissions: lists })));
}

function doSession(floor = RECOMMENDED_FLOOR): Permissions {
  const repo = withSparkFloor(null, floor);
  return permissionsOf(claudeSessionMeta(CLAUDE_DO_TOOLS, [], repo, true, true, []));
}

describe("Claude's flag rules follow Spark's rules", () => {
  it('are unchanged with the recommended rules', () => {
    expect(sparkFloor(RECOMMENDED_RULES)).toEqual(RECOMMENDED_FLOOR);
    expect(withSparkFloor(null, RECOMMENDED_FLOOR)).toBeNull();
  });

  it('drop a flag rule when its Spark rule is removed', () => {
    const permissions = doSession(floorFrom({ deny: ['Push'] }));
    expect(permissions.deny).not.toContain('Edit(**/.env)');
    expect(permissions.deny).not.toEqual(expect.arrayContaining(FORCE_PUSH_DENY_RULES));
    expect(permissions.deny).not.toEqual(expect.arrayContaining(CHAT_RUN_DENY_RULES));
    expect(permissions.ask).not.toContain(GIT_CONFIG_ASK_RULE);
    expect(permissions.ask).not.toContain('Edit(**/AGENTS.md)');
    expect(permissions.ask).toContain('Bash(git push:*)');
  });

  it('add a deny flag rule when a Spark rule is tightened to deny', () => {
    const permissions = doSession(floorFrom({ deny: ['InstructionFile(edit)', 'GitConfig'] }));
    expect(permissions.deny).toEqual(
      expect.arrayContaining(['Edit(**/AGENTS.md)', GIT_CONFIG_ASK_RULE]),
    );
    expect(permissions.ask).not.toContain('Edit(**/AGENTS.md)');
  });

  it('send remote changes to the gate when GitRemote asks', () => {
    const permissions = doSession(floorFrom({ ask: ['GitRemote'] }));
    expect(permissions.ask).toEqual(expect.arrayContaining(CHAT_RUN_DENY_RULES));
    expect(permissions.deny).not.toEqual(expect.arrayContaining(CHAT_RUN_DENY_RULES));
  });
});

describe("Codex's secret file profile follows SecretFile(edit)", () => {
  type Profiles = { permissions: Record<string, { filesystem: Record<string, unknown> }> };

  it('keeps the project secret denies only while the rule holds', () => {
    const held = codexConfig(true, null, true, RECOMMENDED_FLOOR) as Profiles;
    const lifted = codexConfig(true, null, true, floorFrom({})) as Profiles;
    expect(held.permissions['agent']!.filesystem).toHaveProperty(':project_roots');
    expect(lifted.permissions['agent']!.filesystem).not.toHaveProperty(':project_roots');
  });
});

describe('a live session', () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spark-floor-key-'));
    saved = process.env.SPARK_RULES_FILE;
    process.env.SPARK_RULES_FILE = join(dir, 'settings.json');
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.SPARK_RULES_FILE;
    else process.env.SPARK_RULES_FILE = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it('gets a new connection key when the Spark rules change', async () => {
    const turn = {
      prompt: 'hi',
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      signal: new AbortController().signal,
    } as unknown as ProviderTurn;
    const options = { definition: agentDefinitions.claude, launch: { command: 'x', args: [] } };
    await writeFile(process.env.SPARK_RULES_FILE!, recommendedRulesText());
    const first = await planLaunch(options, turn, false);
    await writeFile(process.env.SPARK_RULES_FILE!, JSON.stringify({ permissions: {} }));
    const second = await planLaunch(options, turn, false);
    await Promise.all([discardScratch(first), discardScratch(second)]);
    expect(first.workspace.floor).toEqual(RECOMMENDED_FLOOR);
    expect(second.key).not.toEqual(first.key);
  });

  async function launchedFloor(text: string) {
    const turn = {
      prompt: 'hi',
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      signal: new AbortController().signal,
    } as unknown as ProviderTurn;
    await writeFile(process.env.SPARK_RULES_FILE!, text);
    const options = { definition: agentDefinitions.claude, launch: { command: 'x', args: [] } };
    const plan = await planLaunch(options, turn, false);
    await discardScratch(plan);
    return plan.workspace.floor;
  }

  type Profiles = { permissions: Record<string, { filesystem: Record<string, unknown> }> };

  it('with no rules gives the unseen modes no floor, but keeps the fixed denies', async () => {
    const floor = await launchedFloor('{ "permissions": {} }');
    const permissions = doSession(floor);
    expect(permissions.deny).not.toContain('Edit(**/.env)');
    expect(permissions.deny).not.toEqual(expect.arrayContaining(FORCE_PUSH_DENY_RULES));
    expect(permissions.deny).not.toEqual(expect.arrayContaining(CHAT_RUN_DENY_RULES));
    expect([...permissions.deny, ...(permissions.ask ?? [])]).not.toContain('Edit(**/AGENTS.md)');
    expect([...permissions.deny, ...(permissions.ask ?? [])]).not.toContain(GIT_CONFIG_ASK_RULE);
    expect(permissions.deny).toEqual(
      expect.arrayContaining([...sparkRulesFlagRules(), ...browserDataRules(browserDataDir())]),
    );
    const codex = codexConfig(true, null, true, floor) as Profiles;
    const filesystem = codex.permissions['agent']!.filesystem;
    expect(filesystem).not.toHaveProperty(':project_roots');
    expect(JSON.stringify(filesystem)).toContain(process.env.SPARK_RULES_FILE!);
  });

  it('with the recommended rules keeps every floor flag rule', async () => {
    const floor = await launchedFloor(recommendedRulesText());
    const permissions = doSession(floor);
    expect(permissions.deny).toContain('Edit(**/.env)');
    expect(permissions.deny).toEqual(expect.arrayContaining(FORCE_PUSH_DENY_RULES));
    expect(permissions.deny).toEqual(expect.arrayContaining(CHAT_RUN_DENY_RULES));
    expect(permissions.ask).toEqual(
      expect.arrayContaining(['Edit(**/AGENTS.md)', GIT_CONFIG_ASK_RULE]),
    );
    const codex = codexConfig(true, null, true, floor) as Profiles;
    expect(codex.permissions['agent']!.filesystem).toHaveProperty(':project_roots');
  });
});
