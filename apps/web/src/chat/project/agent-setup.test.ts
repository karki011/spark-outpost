import { describe, expect, it } from 'vitest';
import type { RepoAgentConfig } from '@spark-outpost/contracts';
import {
  executableSummary,
  followingLine,
  ignoredCount,
  needsAttention,
  trustPrompt,
} from './agent-setup.ts';

const config = (change: Partial<RepoAgentConfig> = {}): RepoAgentConfig => ({
  projectId: '00000000-0000-4000-8000-000000000001',
  rootPath: '/work/app',
  settings: {
    instructions: true,
    skills: true,
    commands: true,
    subagents: true,
    hooks: false,
    hooksChanged: false,
  },
  instructions: [{ path: 'AGENTS.md', bytes: 10, nested: false }],
  skills: [],
  commands: [],
  subagents: [],
  hooks: [],
  hooksFingerprint: null,
  mcpServers: [],
  allowRules: [],
  redirects: [],
  trust: {
    needed: false,
    state: 'unset',
    fingerprint: 'f1',
    decidedAt: null,
    changes: [],
    redirects: 'none',
    redirectsFingerprint: null,
  },
  ignored: [],
  warnings: [],
  ...change,
});

const hook = { event: 'Stop', matcher: null, command: 'make', source: '.claude/settings.json' };
const withTrust = (trust: Partial<RepoAgentConfig['trust']>) =>
  config({ hooks: [hook], trust: { ...config().trust, needed: true, ...trust } });

describe('agent setup attention dot', () => {
  it('stays quiet when everything found is in use', () => {
    expect(needsAttention(config())).toBe(false);
    expect(needsAttention(config({ settings: { ...config().settings, skills: false } }))).toBe(
      false,
    );
  });

  it('shows when something found is off, changed or unreadable', () => {
    expect(needsAttention(config({ hooks: [hook] }))).toBe(true);
    expect(
      needsAttention(config({ settings: { ...config().settings, instructions: false } })),
    ).toBe(true);
    expect(needsAttention(config({ settings: { ...config().settings, hooksChanged: true } }))).toBe(
      true,
    );
    expect(needsAttention(config({ warnings: ['.mcp.json is not valid JSON'] }))).toBe(true);
  });
});

describe('agent setup text', () => {
  it('lists followed files and counts ignored settings', () => {
    expect(followingLine(['AGENTS.md', 'CLAUDE.md'])).toBe('Following: AGENTS.md, CLAUDE.md');
    expect(followingLine([])).toBeNull();
    expect(
      ignoredCount(
        config({
          ignored: [
            { source: '.claude/settings.json', kind: 'allow', items: ['Bash', 'Edit'] },
            { source: '.claude/settings.json', kind: 'env', items: ['DEBUG'] },
          ],
        }),
      ),
    ).toBe(3);
  });
});

describe('folder trust prompt', () => {
  it('asks once for a folder with executable parts, and again only after it changes', () => {
    expect(trustPrompt(config())).toBeNull();
    expect(trustPrompt(withTrust({ state: 'unset' }))).toBe('ask');
    expect(trustPrompt(withTrust({ state: 'not_trusted' }))).toBeNull();
    expect(trustPrompt(withTrust({ state: 'trusted' }))).toBeNull();
    expect(trustPrompt(withTrust({ state: 'changed' }))).toBe('changed');
    expect(needsAttention(withTrust({ state: 'changed' }))).toBe(true);
  });

  it('summarizes what trusting would load', () => {
    const rule = { rule: 'Bash(npm test:*)', source: 's', applied: false, reason: null };
    expect(executableSummary(config({ hooks: [hook, hook], allowRules: [rule] }))).toBe(
      '2 hooks, 1 allow rule',
    );
    expect(executableSummary(config())).toBe('Key or proxy settings only');
  });
});
