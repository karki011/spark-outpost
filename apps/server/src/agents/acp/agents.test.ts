import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  supportsDo,
  HIDE_CLAUDE_AUTH,
  agentDefinitions,
  claudeSessionMeta,
  floorAskRules,
  GIT_CONFIG_ASK_RULE,
  FORCE_PUSH_DENY_RULES,
  secretRules,
} from './agents.ts';
import { CLAUDE_DO_TOOLS, CLAUDE_GATED_TOOLS, CLAUDE_READ_TOOLS } from './claude-tools.ts';
import { CODEX_DO_MODE, codexPermissionProfiles } from './codex-permissions.ts';
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

const bashAsks = (options: ClaudeOptions) =>
  ((options.settings.permissions.ask as string[] | undefined) ?? []).filter((rule) =>
    rule.startsWith('Bash'),
  );

describe('Claude session options', () => {
  const project = optionsOf(agentDefinitions.claude.projectSessionMeta?.(['/work/lib']));
  const chat = optionsOf(agentDefinitions.claude.conversationSessionMeta?.());

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
    expect(project.tools).toEqual([...CLAUDE_READ_TOOLS, 'AskUserQuestion']);
    expect(optionsOf(agentDefinitions.claude.projectSessionMeta?.([], null, true)).tools).toEqual([
      ...CLAUDE_READ_TOOLS,
      'Write',
      'ExitPlanMode',
      'AskUserQuestion',
    ]);
    expect(chat.tools).toEqual(['AskUserQuestion']);
  });

  it('passes extra repos only as deny-rule anchors, never as directories in _meta', () => {
    expect(project).not.toHaveProperty('additionalDirectories');
    expect(project.disallowedTools).toContain('Edit(//work/lib/**/.env)');
    expect(project.settings.permissions.deny).toEqual(project.disallowedTools);
  });

  it("denies reading and editing Spark's browser data in every Claude session", () => {
    const saved = process.env.SPARK_DATA_DIR;
    process.env.SPARK_DATA_DIR = '/nowhere/Spark Outpost';
    try {
      const sessions = [
        agentDefinitions.claude.conversationSessionMeta?.(null),
        agentDefinitions.claude.projectSessionMeta?.([], null),
        agentDefinitions.claude.doSessionMeta?.([], null, true),
      ];
      for (const meta of sessions) {
        const options = optionsOf(meta);
        expect(options.disallowedTools).toContain('Read(//nowhere/Spark Outpost/Partitions/**)');
        expect(options.disallowedTools).toContain(
          'Edit(//nowhere/Spark Outpost/postgres-password)',
        );
        expect(options.settings.permissions.deny).toEqual(options.disallowedTools);
      }
    } finally {
      if (saved === undefined) delete process.env.SPARK_DATA_DIR;
      else process.env.SPARK_DATA_DIR = saved;
    }
  });

  it('denies editing the same secret names as the path policy, and leaves reading to the mode', () => {
    const rules = secretRules([]);
    for (const rule of [
      'Edit(**/.env)',
      'Edit(**/.env.*)',
      'Edit(**/.pgpass)',
      'Edit(**/.pypirc)',
      'Edit(**/.git-credentials)',
      'Edit(**/credentials)',
      'Edit(**/credentials.*)',
      'Edit(**/*.p12)',
      'Edit(**/*.pfx)',
      'Edit(**/id_rsa)',
      'Edit(**/id_ed25519.pub)',
    ]) {
      expect(rules).toContain(rule);
    }
    expect(rules.some((rule) => rule.startsWith('Read('))).toBe(false);
    expect(rules.every((rule) => !rule.includes('id_*'))).toBe(true);
  });

  it('matches claudeSessionMeta for the project tools', () => {
    expect(agentDefinitions.claude.projectSessionMeta?.([])).toEqual(
      claudeSessionMeta([...CLAUDE_READ_TOOLS, 'AskUserQuestion'], []),
    );
  });

  it('gives Ask turns a shell and leaves asking to the agent, but for git config', () => {
    const asking = optionsOf(agentDefinitions.claude.projectSessionMeta?.([], null, true, true));
    expect(asking.tools).toEqual([
      ...CLAUDE_READ_TOOLS,
      ...CLAUDE_GATED_TOOLS,
      'Write',
      'ExitPlanMode',
      'AskUserQuestion',
    ]);
    expect(asking.settings.permissions.ask).toEqual(['WebFetch', 'Monitor', GIT_CONFIG_ASK_RULE]);
    expect(project.settings.permissions).not.toHaveProperty('ask');
    expect(project.tools).not.toContain('WebFetch');
    expect(chat.settings.permissions).not.toHaveProperty('ask');
  });

  it('gives Do runs the edit, shell and todo tools and asks only for the safety floor', () => {
    const options = optionsOf(agentDefinitions.claude.doSessionMeta?.([]));
    expect(options.tools).toEqual([...CLAUDE_DO_TOOLS]);
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Monitor', 'WebSearch']) {
      expect(options.tools).toContain(tool);
    }
    expect(options.settings.permissions.ask).toEqual([
      'WebFetch',
      'Monitor',
      ...floorAskRules(options.tools, []),
    ]);
    expect(bashAsks(options)).toEqual([GIT_CONFIG_ASK_RULE]);
    expect(options.settings.permissions).toMatchObject({
      blockReadsOutsideWorkingDirectories: true,
      deny: expect.arrayContaining([...FORCE_PUSH_DENY_RULES, 'Edit(**/.env)']),
    });
    expect(options.settings.permissions).not.toHaveProperty('disableBypassPermissionsMode');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(supportsDo(agentDefinitions.claude)).toBe(true);
  });

  it('offers bypass only to Do sessions and the capability probe, never to chats or Ask', () => {
    const probe = optionsOf(agentDefinitions.claude.probeSessionMeta);
    expect(probe.allowDangerouslySkipPermissions).toBe(true);
    expect(probe.tools).toEqual([]);
    expect(project.allowDangerouslySkipPermissions).toBe(false);
    expect(chat.allowDangerouslySkipPermissions).toBe(false);
  });

  it("runs Ask in Claude's default mode, since plan mode points the model at tools Ask doesn't have", () => {
    expect(agentDefinitions.claude.askMode).toBe('default');
    expect(agentDefinitions.claude.doMode).toBe('default');
    expect(agentDefinitions.codex.askMode).toBe('read-only');
  });
});

describe('Codex launch', () => {
  it('reads project folders through its shell and keeps the shell off in chats', () => {
    expect(agentDefinitions.codex.readsProjectFolders).toBe(true);
    expect(agentDefinitions.codex.projectSessionMeta).toBeUndefined();
    const chat = agentDefinitions.codex.conversationEnv?.('/tmp/run') ?? {};
    expect(chat).toMatchObject({ INITIAL_AGENT_MODE: 'read-only', TMPDIR: '/tmp/run' });
    expect(JSON.parse(chat.CODEX_CONFIG ?? '{}')).toEqual({
      features: {
        shell_tool: false,
        unified_exec: false,
        skill_mcp_dependency_install: false,
        apps: false,
      },
      default_permissions: 'read-only',
      permissions: codexPermissionProfiles(),
    });
    const project = agentDefinitions.codex.conversationEnv?.('/tmp/run', true) ?? {};
    expect(project).toMatchObject({ INITIAL_AGENT_MODE: 'read-only' });
    expect(JSON.parse(project.CODEX_CONFIG ?? '{}')).toMatchObject({
      features: { shell_tool: true, unified_exec: false, skill_mcp_dependency_install: false },
      default_permissions: 'read-only',
    });
    expect(JSON.parse(project.CODEX_CONFIG ?? '{}')).not.toHaveProperty('web_search');
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

    it('waits for sub-agents without a timer of its own', () => {
      const wait = source.slice(source.indexOf('async wait(signal, timeoutMs ='));
      expect(source).toContain('static DEFAULT_WAIT_TIMEOUT_MS = Number.POSITIVE_INFINITY;');
      expect(source).not.toContain('DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1e3');
      expect(wait.slice(0, wait.indexOf('async finishOutstanding('))).toContain(
        'Number.isFinite(remainingMs) ? setTimeout(',
      );
    });

    it("reports each sub-agent's tokens, turns and model when it ends", () => {
      expect(source).toContain(
        'if (reporting) reporting.usage = notification.params.tokenUsage?.total;',
      );
      expect(source).toContain('if (starting) starting.turns = (starting.turns ?? 0) + 1;');
      expect(source).toContain(
        '_meta: { codex: { usage: child.usage, turns: child.turns, model: this.modelOf(child) } }',
      );
    });

    it("gives a sub-agent its parent's model when its spawn names none", () => {
      expect(source).toContain(
        'await this.subagents.handle(notification, this.sessionState.currentModelId)',
      );
      expect(source).toContain('model: this.modelOf(child)');
      const modelOf = source.slice(source.indexOf('  modelOf(child) {'));
      expect(modelOf.slice(0, modelOf.indexOf('\n  }'))).toContain('return this.rootModel;');
    });

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

    it('gives every Codex mode a permission profile, so no turn falls back to a bare sandbox', () => {
      const modes = block('static all() {');
      const profiles = codexPermissionProfiles();
      const ids = [...source.matchAll(/static (\w+) = new _AgentMode\(\s*"([^"]+)"/g)].map(
        (match) => match[2]!,
      );
      expect(ids).toHaveLength(4);
      for (const id of ids) expect(profiles).toHaveProperty(id);
      expect(modes).toContain('_AgentMode.AgentFullAccess');
    });

    it('selects the named profile for a turn instead of the legacy sandbox policy', () => {
      const method = source.slice(
        source.indexOf('  turnSandbox(agentMode, cwd, additionalDirectories) {'),
        source.indexOf('  async setCollaborationMode('),
      );
      const helpers = ['function uniqueStrings(', 'function isJsonObject('].map((marker) =>
        source.slice(source.indexOf(marker), source.indexOf('\n}\n', source.indexOf(marker)) + 3),
      );
      const Client = new Function(
        `function addAdditionalDirectoriesToSandboxPolicy(policy) { return policy; }
        ${helpers.join('\n')}
        return class { constructor(config) { this.config = config; }\n${method}\n};`,
      )() as new (config: object) => {
        turnSandbox: (mode: object, cwd: string, extra: string[]) => Record<string, unknown>;
      };
      const mode = { id: 'agent-full-access', sandboxPolicy: { type: 'dangerFullAccess' } };
      const configured = new Client({ permissions: codexPermissionProfiles() });
      expect(configured.turnSandbox(mode, '/work/app', ['/work/lib'])).toEqual({
        permissions: 'agent-full-access',
        runtimeWorkspaceRoots: ['/work/app', '/work/lib'],
      });
      expect(new Client({}).turnSandbox(mode, '/work/app', [])).toEqual({
        sandboxPolicy: { type: 'dangerFullAccess' },
      });
      expect(source).toContain('...this.turnSandbox(agentMode, cwd, additionalDirectories),');
    });

    it('marks session roots untrusted so a repo’s .codex/config.toml is never loaded', () => {
      const config = source.slice(
        source.indexOf('async createSessionConfig('),
        source.indexOf('mergeSandboxWorkspaceWriteRoots(mergedConfig'),
      );
      expect(config).toContain('trust_level: "untrusted"');
      expect(source).not.toContain('trust_level: "trusted"');
    });

    it('keeps CODEX_CONFIG mcp_servers next to ACP servers so user-level ones stay off', () => {
      const config = source.slice(
        source.indexOf('async createSessionConfig('),
        source.indexOf('async getConfigMcpServerNames('),
      );
      expect(config).toContain(
        '...isJsonObject(configWithWorkspaceRoots["mcp_servers"]) ? configWithWorkspaceRoots["mcp_servers"] : {},',
      );
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
    expect(zai.conversationSessionMeta).toBe(agentDefinitions.claude.conversationSessionMeta);
    expect(zai.projectSessionMeta?.(['/w'])).toEqual(
      agentDefinitions.claude.projectSessionMeta?.(['/w']),
    );
    expect(zai.doSessionMeta?.([])).toEqual(agentDefinitions.claude.doSessionMeta?.([]));
    expect(optionsOf(zai.doSessionMeta?.([]))).toMatchObject({ settingSources: [] });
    expect(optionsOf(zai.projectSessionMeta?.([]))).toMatchObject({
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
