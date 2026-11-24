import ignore from 'ignore';
import { describe, expect, it } from 'vitest';
import { agentDefinitions, floorDenyRules } from '../src/agents/acp/agents.ts';
import { RECOMMENDED_FLOOR } from '../src/spark-rules/floor-flags.ts';
import { sessionAskRules } from './fake-acp-floor.ts';

const EDIT_RULE = /^Edit\((.+)\)$/;
const DENYING = { ...RECOMMENDED_FLOOR, instructions: 'deny', gitConfig: 'deny' } as const;

function relativePatterns(rules: readonly string[]): string[] {
  return rules.flatMap((rule) => {
    const pattern = EDIT_RULE.exec(rule)?.[1];
    if (!pattern || pattern.startsWith('/')) return [];
    return [pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern];
  });
}

function claudeMatches(rules: readonly string[], relative: string): boolean {
  return ignore().add(relativePatterns(rules)).ignores(relative);
}

const VARIANTS = [
  'agents.MD',
  'docs/Agents.md',
  'packages/web/claude.MD',
  '.CLAUDE/settings.json',
  '.Cursor/Rules/style.mdc',
  '.GIT/hooks/pre-commit',
  '.git/HOOKS/x',
  '.Git/Config',
  '.GitHub/Copilot-Instructions.md',
];

const ORDINARY = [
  'src/app.ts',
  'README.md',
  'docs/agents.ts',
  '.github/workflows/ci.yml',
  '.gitignore',
];

describe('the Edit rules Spark gives Claude, run through the ignore library Claude matches them with', () => {
  const ask = sessionAskRules(agentDefinitions.claude.doSessionMeta?.([]));

  it.each(VARIANTS)('ask rules match %s in another letter case', (relative) => {
    expect(claudeMatches(ask, relative)).toBe(true);
  });

  it.each(VARIANTS)('deny rules match %s in another letter case', (relative) => {
    const deny = floorDenyRules(['Edit'], [], [], DENYING);
    expect(claudeMatches(deny, relative)).toBe(true);
  });

  it.each(ORDINARY)('match no ordinary file %s', (relative) => {
    expect(claudeMatches(ask, relative)).toBe(false);
  });
});
