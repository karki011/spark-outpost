import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_PUBLISH_DENY_RULES,
  CODEX_DO_MODE,
  supportsDo,
  HIDE_CLAUDE_AUTH,
  agentDefinitions,
  claudeSessionMeta,
  secretReadRules,
} from './agents.ts';
import { zaiEnvironment, zaiModelId } from './zai.ts';

type ClaudeOptions = {
  tools: string[];
  disallowedTools: string[];
  settingSources: string[];
  allowDangerouslySkipPermissions: boolean;
  settings: { permissions: Record<string, unknown> };
  strictMcpConfig: boolean;
};

const optionsOf = (meta: Record<string, unknown> | undefined) =>
  (meta as { claudeCode: { options: ClaudeOptions } }).claudeCode.options;

describe('Claude session options', () => {
  const project = optionsOf(agentDefinitions.claude.projectSessionMeta?.(['/work/lib']));
  const chat = optionsOf(agentDefinitions.claude.conversationSessionMeta);

  it('ignores repo and user settings, blocks bypass mode and reads outside the roots', () => {
    for (const options of [project, chat]) {
      expect(options.settingSources).toEqual([]);
      expect(options.allowDangerouslySkipPermissions).toBe(false);
      expect(options.strictMcpConfig).toBe(true);
      expect(options.settings.permissions).toMatchObject({
        blockReadsOutsideWorkingDirectories: true,
        disableBypassPermissionsMode: 'disable',
      });
    }
    expect(project.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(chat.tools).toEqual([]);
  });

  it('passes extra repos only as deny-rule anchors, never as directories in _meta', () => {
    expect(project).not.toHaveProperty('additionalDirectories');
    expect(project.disallowedTools).toContain('Read(//work/lib/**/.env)');
    expect(project.settings.permissions.deny).toEqual(project.disallowedTools);
  });

  it('denies the same secret names as the path policy', () => {
    const rules = secretReadRules([]);
    for (const rule of [
      'Read(**/.env)',
      'Read(**/.env.*)',
      'Read(**/.pgpass)',
      'Read(**/.pypirc)',
      'Read(**/.git-credentials)',
      'Read(**/credentials)',
      'Read(**/credentials.*)',
      'Read(**/*.p12)',
      'Read(**/*.pfx)',
      'Read(**/id_rsa)',
      'Read(**/id_ed25519.pub)',
    ]) {
      expect(rules).toContain(rule);
    }
    expect(rules).not.toContain('Read(**/id_*)');
    expect(rules.every((rule) => !rule.includes('id_*'))).toBe(true);
  });

  it('matches claudeSessionMeta for the project tools', () => {
    expect(agentDefinitions.claude.projectSessionMeta?.([])).toEqual(
      claudeSessionMeta(['Read', 'Glob', 'Grep'], []),
    );
  });

  it('gives Do runs the edit, shell and todo tools, forces every change to ask, and keeps bypass off', () => {
    const options = optionsOf(agentDefinitions.claude.doSessionMeta?.([]));
    expect(options.tools).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Edit',
      'Write',
      'Bash',
      'TodoWrite',
      'EnterPlanMode',
      'ExitPlanMode',
    ]);
    expect(options.settings.permissions).toMatchObject({
      ask: ['Bash', 'Edit', 'Write'],
      blockReadsOutsideWorkingDirectories: true,
      disableBypassPermissionsMode: 'disable',
    });
    expect(options.allowDangerouslySkipPermissions).toBe(false);
    expect(supportsDo(agentDefinitions.claude)).toBe(true);
  });

  it('denies pushing, gh and remote changes to Builders, and only to Builders', () => {
    const builder = optionsOf(agentDefinitions.claude.doSessionMeta?.([], null, true));
    const deny = builder.settings.permissions.deny as string[];
    for (const rule of ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(git remote add:*)']) {
      expect(BUILDER_PUBLISH_DENY_RULES).toContain(rule);
      expect(deny).toContain(rule);
      expect(builder.disallowedTools).toContain(rule);
    }
    expect(deny).toEqual(expect.arrayContaining(secretReadRules([])));
    const plain = optionsOf(agentDefinitions.claude.doSessionMeta?.([]));
    expect(plain.settings.permissions.deny).not.toContain('Bash(git push:*)');
    const zai = optionsOf(agentDefinitions.zai.doSessionMeta?.([], null, true));
    expect(zai.settings.permissions.deny).toContain('Bash(gh:*)');
  });
});

describe('Codex launch', () => {
  it('reads project folders through its shell and keeps the shell off in chats', () => {
    expect(agentDefinitions.codex.readsProjectFolders).toBe(true);
    expect(agentDefinitions.codex.projectSessionMeta).toBeUndefined();
    const chat = agentDefinitions.codex.conversationEnv?.('/tmp/run') ?? {};
    expect(chat).toMatchObject({ INITIAL_AGENT_MODE: 'read-only', TMPDIR: '/tmp/run' });
    expect(JSON.parse(chat.CODEX_CONFIG ?? '{}')).toEqual({
      features: { shell_tool: false, unified_exec: false, skill_mcp_dependency_install: false },
      web_search: 'disabled',
    });
    const project = agentDefinitions.codex.conversationEnv?.('/tmp/run', true) ?? {};
    expect(project).toMatchObject({ INITIAL_AGENT_MODE: 'read-only' });
    expect(JSON.parse(project.CODEX_CONFIG ?? '{}')).toEqual({
      features: { shell_tool: true, unified_exec: false, skill_mcp_dependency_install: false },
      web_search: 'disabled',
    });
  });

  it('does Do in the patched ask-every-action mode, opening only the primary repo', () => {
    expect(agentDefinitions.codex.doMode).toBe(CODEX_DO_MODE);
    expect(agentDefinitions.codex.doPrimaryRootOnly).toBe(true);
    expect(agentDefinitions.codex.doSessionMeta).toBeUndefined();
    expect(supportsDo(agentDefinitions.codex)).toBe(true);
  });

  describe('the codex-acp patch', () => {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('@agentclientprotocol/codex-acp/package.json');
    const source = readFileSync(join(dirname(manifest), 'dist/index.js'), 'utf8');
    const block = (marker: string) => {
      const start = source.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf(');', start));
    };

    it('makes read-only a readOnly sandbox', () => {
      const mode = block('static ReadOnly = new _AgentMode(');
      expect(mode).toContain('type: "readOnly"');
      expect(mode).not.toContain('workspaceWrite');
    });

    it('adds an ask-every-action mode: untrusted, user-reviewed, sandboxed without network', () => {
      const mode = block('static AskEveryAction = new _AgentMode(');
      expect(mode).toContain(`"${CODEX_DO_MODE}"`);
      expect(mode).toContain('"untrusted"');
      expect(mode).toContain('"user"');
      expect(mode).toContain('type: "workspaceWrite"');
      expect(mode).toContain('networkAccess: false');
      expect(mode).toContain('excludeSlashTmp: true');
      expect(source).toContain('_AgentMode.ReadOnly, _AgentMode.AskEveryAction,');
    });

    it('marks session roots untrusted so a repo’s .codex/config.toml is never loaded', () => {
      const config = source.slice(
        source.indexOf('async createSessionConfig('),
        source.indexOf('mergeSandboxWorkspaceWriteRoots(mergedConfig'),
      );
      expect(config).toContain('trust_level: "untrusted"');
      expect(source).not.toContain('trust_level: "trusted"');
    });

    it('reports the whole turn’s tokens, not only the last model request', () => {
      expect(source).not.toContain('buildPromptUsage(sessionState.lastTokenUsage)');
      expect(source.split('buildPromptUsage(turnPromptUsage(sessionState))')).toHaveLength(5);
      const helpers = source.slice(
        source.indexOf('var TOKEN_USAGE_FIELDS'),
        source.indexOf('function turnPromptUsage('),
      );
      const { step, add } = new Function(
        `${helpers}; return { step: tokenUsageStep, add: addTokenUsage };`,
      )() as {
        step: (usage: object, previous: object | undefined) => Record<string, number>;
        add: (sum: object | null, step: object) => Record<string, number>;
      };
      const usage = (input: number, cached: number, output: number) => ({
        totalTokens: input + output,
        inputTokens: input,
        cachedInputTokens: cached,
        outputTokens: output,
        reasoningOutputTokens: 0,
      });
      const first = { last: usage(100, 80, 10), total: usage(500, 400, 50) };
      const second = { last: usage(120, 100, 5), total: usage(620, 500, 55) };
      let turn = add(null, step(first, undefined));
      turn = add(turn, step(second, first.total));
      turn = add(turn, step(second, second.total));
      expect(turn).toEqual(usage(220, 180, 15));
    });

    it('offers decline before cancel for commands and file changes', () => {
      const commands = source.slice(
        source.indexOf('function commandDecisionOptions(params) {'),
        source.indexOf('function permissionOptionOrder('),
      );
      expect(commands).toContain('decisions.splice(');
      expect(commands).toContain('"decline"');
      const files = source.slice(
        source.indexOf('function fileChangeDecisionOptions()'),
        source.indexOf('function permissionProfileOptions()'),
      );
      expect(files.indexOf('ApprovalOptionId.Decline')).toBeGreaterThan(-1);
      expect(files.indexOf('ApprovalOptionId.Decline')).toBeLessThan(
        files.indexOf('ApprovalOptionId.Cancel'),
      );
    });
  });
});

describe('Z.ai launch', () => {
  const KEY = 'zai-unit-key.0123456789';
  const parent = {
    PATH: '/usr/bin:/bin',
    HOME: '/Users/someone',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ANTHROPIC_API_KEY: 'sk-ant-api03-parent',
    ANTHROPIC_AUTH_TOKEN: 'parent-token',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    ANTHROPIC_MODEL: 'claude-opus-5-5',
    ANTHROPIC_CUSTOM_HEADERS: 'x-org: acme',
    CLAUDE_CODE_OAUTH_TOKEN: 'parent-oauth',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CONFIG_DIR: '/Users/someone/.claude',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '/Users/someone/.claude',
    AWS_BEARER_TOKEN_BEDROCK: 'bedrock',
    OPENAI_API_KEY: 'sk-proj-parent',
    DATABASE_URL: 'postgres://user:pass@localhost/db',
  };
  const env = zaiEnvironment(parent, KEY, '/tmp/zai-config');

  it('keeps none of the parent Anthropic, Claude or other credentials', () => {
    expect(env).toMatchObject({
      PATH: parent.PATH,
      HOME: parent.HOME,
      LANG: parent.LANG,
      LC_ALL: parent.LC_ALL,
    });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_MODEL');
    expect(env).not.toHaveProperty('ANTHROPIC_CUSTOM_HEADERS');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK');
    expect(env).not.toHaveProperty('CLAUDE_SECURESTORAGE_CONFIG_DIR');
    expect(env).not.toHaveProperty('AWS_BEARER_TOKEN_BEDROCK');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('DATABASE_URL');
    expect(Object.values(env)).not.toContain('parent-token');
  });

  it('points Claude Code at Z.ai with the key, an isolated config dir and the documented settings', () => {
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: KEY,
      CLAUDE_CONFIG_DIR: '/tmp/zai-config',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3[1m]',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'glm-5.3[1m]',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.3-flash[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'GLM-5.3',
      ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'GLM-5.3-Flash',
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    const anthropic = Object.keys(env).filter(
      (name) => name.startsWith('ANTHROPIC_') && !name.startsWith('ANTHROPIC_DEFAULT_'),
    );
    expect(anthropic.sort()).toEqual(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']);
  });

  it('runs claude-agent-acp with the subscription guard and the same hardening as Claude', () => {
    const zai = agentDefinitions.zai;
    expect(zai.launch().args.at(-1)).toBe(HIDE_CLAUDE_AUTH);
    expect(agentDefinitions.claude.launch().args).not.toContain(HIDE_CLAUDE_AUTH);
    expect(zai.conversationMode).toBe('default');
    expect(zai.conversationSessionMeta).toEqual(agentDefinitions.claude.conversationSessionMeta);
    expect(zai.projectSessionMeta?.(['/w'])).toEqual(
      agentDefinitions.claude.projectSessionMeta?.(['/w']),
    );
    expect(zai.doSessionMeta?.([])).toEqual(agentDefinitions.claude.doSessionMeta?.([]));
    expect(optionsOf(zai.doSessionMeta?.([]))).toMatchObject({
      settingSources: [],
      allowDangerouslySkipPermissions: false,
    });
    expect(zai.conversationEnv).toBeUndefined();
    expect(zai.estimatesCost).toBe(true);
  });

  it('records the GLM model behind each Claude Code model slot', () => {
    expect(zaiModelId('opus')).toBe('glm-5.3');
    expect(zaiModelId('sonnet')).toBe('glm-5.3');
    expect(zaiModelId('haiku')).toBe('glm-5.3-flash');
    expect(zaiModelId('glm-5.3-flash[1m]')).toBe('glm-5.3-flash');
    expect(zaiModelId(null)).toBeNull();
    expect(agentDefinitions.zai.offers).toEqual({
      models: ['opus', 'haiku'],
      efforts: ['low', 'high', 'max'],
    });
  });
});
