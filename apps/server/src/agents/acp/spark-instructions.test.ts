import { describe, expect, it } from 'vitest';
import type { SparkSessionPrefs } from '@spark-outpost/contracts';
import {
  CODEX_INSTRUCTIONS_METHOD,
  SPARK_INSTRUCTIONS_MAX_LENGTH,
  auditCodexInstructions,
  sparkInstructions,
  withClaudeSpark,
  withCodexSpark,
} from './spark-instructions.ts';

const PREFS: SparkSessionPrefs = {
  displayName: '  Sam Rivera ',
  personality: 'friendly',
};

describe('sparkInstructions', () => {
  it('asks for coordinator work, the first name and the friendly tone by default', () => {
    const text = sparkInstructions(PREFS, true);
    expect(text).toContain('act as a coordinator');
    expect(text).toContain('with the Agent tool');
    expect(text).toContain('Answer simple questions directly without delegating.');
    expect(text).toContain(
      "The user's name is Sam. Use it when you explain something or ask them a question.",
    );
    expect(text).toContain('Tone: warm and concise.');
    expect(text).not.toContain('Rivera');
  });

  it('words team mode as a checklist when the agent has no subagents', () => {
    const text = sparkInstructions(PREFS, false);
    expect(text).toContain('keep a short checklist');
    expect(text).not.toContain('Agent tool');
  });

  it('leaves out only the name line when no name is saved', () => {
    const text = sparkInstructions({ ...PREFS, displayName: '   ' }, true);
    expect(text).not.toContain('name is');
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('act as a coordinator');
  });

  it('keeps humour out of failures for every personality', () => {
    expect(sparkInstructions({ ...PREFS, personality: 'playful' }, true)).toContain(
      'light humour, and celebrate wins. Keep errors and failures plain, with no jokes.',
    );
    expect(sparkInstructions({ ...PREFS, personality: 'facts' }, true)).toContain(
      'Tone: terse and factual. No pleasantries or small talk.',
    );
  });

  it('stays within its length budget even with the longest name', () => {
    const longest = { ...PREFS, displayName: 'x'.repeat(40), personality: 'playful' as const };
    expect(sparkInstructions(longest, true).length).toBeLessThanOrEqual(
      SPARK_INSTRUCTIONS_MAX_LENGTH,
    );
  });
});

describe('withClaudeSpark', () => {
  it('adds the instructions after repository instructions and allows subagents with tools', () => {
    const repo = {
      appendPrompt: '# Repository instructions',
      plugins: [],
      hooks: null,
      mcpNames: [],
      skillTool: false,
      agentTool: false,
    };
    const merged = withClaudeSpark(repo, PREFS, true)!;
    expect(merged.appendPrompt).toMatch(/^# Repository instructions\n\n# Working with the user/);
    expect(merged.agentTool).toBe(true);
  });

  it('never gives a chat session without tools the Agent tool', () => {
    const merged = withClaudeSpark(null, PREFS, false)!;
    expect(merged.agentTool).toBe(false);
    expect(merged.appendPrompt).toContain('keep a short checklist');
  });

  it('changes nothing without preferences', () => {
    expect(withClaudeSpark(null, undefined, true)).toBeNull();
  });
});

describe('withCodexSpark', () => {
  it('puts the instructions in developer instructions without subagent wording', () => {
    const merged = withCodexSpark(null, PREFS)!;
    expect(merged.developerInstructions).toContain('keep a short checklist');
    expect(merged).toMatchObject({ agentsMd: true, skills: true });
  });

  it('appends after repository developer instructions', () => {
    const merged = withCodexSpark(
      { developerInstructions: 'Repo rules', agentsMd: false, skills: false },
      PREFS,
    )!;
    expect(merged.developerInstructions).toMatch(/^Repo rules\n\n# Working with the user/);
    expect(merged.agentsMd).toBe(false);
  });
});

describe('auditCodexInstructions', () => {
  it('records the developer instructions Codex gets as a harness entry', () => {
    const messages: unknown[][] = [];
    const audit = { message: (...args: unknown[]) => messages.push(args), stderr: () => undefined };
    auditCodexInstructions(audit, withCodexSpark(null, PREFS));
    expect(messages).toHaveLength(1);
    const [direction, message] = messages[0]!;
    expect(direction).toBe('harness');
    expect(message).toMatchObject({ method: CODEX_INSTRUCTIONS_METHOD });
    expect(JSON.stringify(message)).toContain('keep a short checklist');
  });

  it('records nothing when no instructions are sent', () => {
    const messages: unknown[] = [];
    const audit = { message: (...args: unknown[]) => messages.push(args), stderr: () => undefined };
    auditCodexInstructions(audit, null);
    auditCodexInstructions(undefined, withCodexSpark(null, PREFS));
    expect(messages).toEqual([]);
  });
});
