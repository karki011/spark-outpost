import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentDefinitions, claudeSessionMeta, secretReadRules } from './agents.ts';

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

  it('gives Do runs the edit and shell tools, forces every change to ask, and keeps bypass off', () => {
    const options = optionsOf(agentDefinitions.claude.doSessionMeta?.([]));
    expect(options.tools).toEqual(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash']);
    expect(options.settings.permissions).toMatchObject({
      ask: ['Bash', 'Edit', 'Write'],
      blockReadsOutsideWorkingDirectories: true,
      disableBypassPermissionsMode: 'disable',
    });
    expect(options.allowDangerouslySkipPermissions).toBe(false);
    expect(agentDefinitions.claude.doUnavailableReason).toBeUndefined();
  });
});

describe('Codex launch', () => {
  it('reads project folders through its shell and keeps the shell off in chats', () => {
    expect(agentDefinitions.codex.readsProjectFolders).toBe(true);
    expect(agentDefinitions.codex.projectSessionMeta).toBeUndefined();
    const chat = agentDefinitions.codex.conversationEnv?.('/tmp/run') ?? {};
    expect(chat).toMatchObject({ INITIAL_AGENT_MODE: 'read-only', TMPDIR: '/tmp/run' });
    expect(JSON.parse(chat.CODEX_CONFIG ?? '{}')).toEqual({
      features: { shell_tool: false, unified_exec: false },
      web_search: 'disabled',
    });
    const project = agentDefinitions.codex.conversationEnv?.('/tmp/run', true) ?? {};
    expect(project).toMatchObject({ INITIAL_AGENT_MODE: 'read-only' });
    expect(JSON.parse(project.CODEX_CONFIG ?? '{}')).toEqual({
      features: { shell_tool: true, unified_exec: false },
      web_search: 'disabled',
    });
  });

  it('has no Do mode, because its sandboxed commands never ask', () => {
    expect(agentDefinitions.codex.doSessionMeta).toBeUndefined();
    expect(agentDefinitions.codex.doUnavailableReason).toMatch(/can't ask before each command/);
  });

  it('runs a codex-acp whose read-only mode is a readOnly sandbox', () => {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve('@agentclientprotocol/codex-acp/package.json');
    const source = readFileSync(join(dirname(manifest), 'dist/index.js'), 'utf8');
    const start = source.indexOf('static ReadOnly = new _AgentMode(');
    const mode = source.slice(start, source.indexOf(');', start));
    expect(start).toBeGreaterThan(-1);
    expect(mode).toContain('type: "readOnly"');
    expect(mode).not.toContain('workspaceWrite');
  });
});
