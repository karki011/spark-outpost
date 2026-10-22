import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentDefinitions, floorAskRules, FORCE_PUSH_DENY_RULES } from './agents.ts';
import {
  CLAUDE_DO_TOOLS,
  CLAUDE_OFF_TOOL_NAMES,
  CLAUDE_READ_TOOLS,
  CLAUDE_REPO_TOOLS,
  WEB_FETCH_LOCAL_DENY_RULES,
} from './claude-tools.ts';
import { withPermissionRules, type ClaudeRepoOptions } from './repo-session.ts';
import { sessionMeta } from './session-start.ts';

type Options = {
  tools: string[];
  disallowedTools: string[];
  settings: Record<string, unknown> & { permissions: { deny: string[]; ask?: string[] } };
};

const optionsOf = (meta: Record<string, unknown> | undefined) =>
  (meta as { claudeCode: { options: Options } }).claudeCode.options;

const INTERFACE_TOOL: Readonly<Record<string, string>> = {
  FileEdit: 'Edit',
  FileRead: 'Read',
  FileWrite: 'Write',
};

function sdkToolNames(): string[] {
  const require = createRequire(import.meta.url);
  const acp = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  const fromAcp = createRequire(acp);
  const sdk = dirname(fromAcp.resolve('@anthropic-ai/claude-agent-sdk'));
  const source = readFileSync(join(sdk, 'sdk-tools.d.ts'), 'utf8');
  const names = [...source.matchAll(/^export interface (\w+)Input\b/gm)].map((match) => match[1]!);
  return names.filter((name) => name !== 'Mcp').map((name) => INTERFACE_TOOL[name] ?? name);
}

describe('Claude built-in tools', () => {
  it('classifies every tool the pinned SDK declares, so a new one fails here first', () => {
    const classified = new Set<string>([
      ...CLAUDE_DO_TOOLS,
      ...CLAUDE_REPO_TOOLS,
      ...CLAUDE_OFF_TOOL_NAMES,
    ]);
    const declared = sdkToolNames();
    expect(declared).toEqual(expect.arrayContaining(['WebSearch', 'Monitor', 'EnterWorktree']));
    const unclassified = declared.filter((name) => !classified.has(name));
    expect(unclassified).toEqual([]);
  });

  it('never offers a tool that is kept off, and denies every one of them by name', () => {
    const doing = optionsOf(agentDefinitions.claude.doSessionMeta?.([]));
    const asking = optionsOf(agentDefinitions.claude.projectSessionMeta?.([], null, true, true));
    for (const options of [doing, asking]) {
      expect(options.tools.filter((tool) => CLAUDE_OFF_TOOL_NAMES.includes(tool))).toEqual([]);
      expect(options.disallowedTools).toEqual(expect.arrayContaining(CLAUDE_OFF_TOOL_NAMES));
      expect(options.disallowedTools).toEqual(expect.arrayContaining(WEB_FETCH_LOCAL_DENY_RULES));
      expect(options.tools).toContain('AskUserQuestion');
    }
    expect(doing.tools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'NotebookEdit']));
    expect(asking.tools).not.toContain('Edit');
    expect(asking.tools).not.toContain('NotebookEdit');
    expect(CLAUDE_READ_TOOLS).not.toContain('Bash');
  });

  it('keeps a chat with no project to its question tool and its wakeup', () => {
    const chat = optionsOf(agentDefinitions.claude.conversationSessionMeta?.());
    expect(chat.tools).toEqual(['AskUserQuestion', 'ScheduleWakeup']);
    expect(chat.disallowedTools).toEqual(expect.arrayContaining(CLAUDE_OFF_TOOL_NAMES));
  });

  it('lets every chat turn schedule a wakeup, and keeps it off in Ask Spark', () => {
    const claude = agentDefinitions.claude;
    const asking = optionsOf(claude.projectSessionMeta?.([], null, false, false));
    const doing = optionsOf(claude.doSessionMeta?.([]));
    for (const options of [asking, doing]) expect(options.tools).toContain('ScheduleWakeup');
    expect(CLAUDE_OFF_TOOL_NAMES).not.toContain('ScheduleWakeup');

    const assistant = { sparkScope: { assistant: true } } as Parameters<typeof sessionMeta>[4];
    const ask = optionsOf(sessionMeta(claude, null, false, null, assistant) ?? undefined);
    expect(ask.tools).toEqual(['AskUserQuestion']);
    expect(ask.disallowedTools).toContain('ScheduleWakeup');
    expect(ask.settings.permissions.deny).toContain('ScheduleWakeup');
  });
});

describe('the user and project deny and ask rules', () => {
  const rules = {
    deny: ['WebSearch', 'Bash(rm:*)', 'Edit(**/.env)'],
    ask: ['Bash(npm publish:*)', 'Bash(git config:*)'],
  };

  it('reach the session as deny and ask rules, with the safety floor on top', () => {
    const repo = withPermissionRules(null, rules);
    const options = optionsOf(agentDefinitions.claude.doSessionMeta?.([], repo, true));
    expect(options.disallowedTools).toEqual(options.settings.permissions.deny);
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(['WebSearch', 'Bash(rm:*)', ...FORCE_PUSH_DENY_RULES]),
    );
    expect(options.disallowedTools.filter((rule) => rule === 'Edit(**/.env)')).toHaveLength(1);
    expect(options.settings.permissions.ask).toEqual(
      expect.arrayContaining([
        'Bash(npm publish:*)',
        'WebFetch',
        'Monitor',
        ...floorAskRules(options.tools, []),
        'Bash(git push:*)',
      ]),
    );
    expect(
      options.settings.permissions.ask!.filter((rule) => rule.startsWith('Bash(git config')),
    ).toHaveLength(1);
  });

  it('carry nothing else from the files: no env, hooks or key helper', () => {
    const repo = withPermissionRules(null, rules) as ClaudeRepoOptions;
    const options = optionsOf(agentDefinitions.claude.doSessionMeta?.([], repo));
    expect(options.settings).not.toHaveProperty('env');
    expect(options.settings).not.toHaveProperty('apiKeyHelper');
    expect(options.settings).not.toHaveProperty('hooks');
    expect(options.settings.disableAllHooks).toBe(true);
    expect(options.settings.permissions).not.toHaveProperty('allow');
  });

  it('leave the repo options alone when the files have no rules', () => {
    expect(withPermissionRules(null, { deny: [], ask: [] })).toBeNull();
  });

  it('apply to Z.ai sessions too, which share Claude session options', () => {
    const repo = withPermissionRules(null, rules);
    const options = optionsOf(agentDefinitions.zai.doSessionMeta?.([], repo));
    expect(options.disallowedTools).toContain('WebSearch');
  });
});
