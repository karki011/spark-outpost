import { describe, expect, it } from 'vitest';
import type { SparkSessionPrefs } from '@spark-outpost/contracts';
import {
  CODEX_INSTRUCTIONS_METHOD,
  SPARK_INSTRUCTIONS_MAX_LENGTH,
  auditCodexInstructions,
  sparkInstructions,
  teammateBriefText,
  withClaudeSpark,
  withCodexSpark,
} from './spark-instructions.ts';

const NO_REPO = {
  appendPrompt: null,
  plugins: [],
  hooks: null,
  mcpNames: [],
  skillTool: false,
  agentTool: false,
};

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
      "The user's name is Sam; use it sparingly, not to open or close every reply.",
    );
    expect(text).not.toMatch(/address the user|use it when/i);
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

  it('points at the spark_* tools only when the session has them, without cutting the text', () => {
    const longest = { ...PREFS, displayName: 'x'.repeat(40), personality: 'playful' as const };
    const text = sparkInstructions(longest, true, true);
    expect(text.endsWith('run only after the user confirms a card.')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(SPARK_INSTRUCTIONS_MAX_LENGTH);
    expect(sparkInstructions(PREFS, true)).not.toContain('spark_*');
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

  it('allows the Spark server without an ask, even when no Spark preferences are set', () => {
    expect(withClaudeSpark(null, undefined, false, 'spark')!.allowRules).toEqual(['mcp__spark']);
    const merged = withClaudeSpark(
      { ...NO_REPO, allowRules: ['Bash(npm test:*)'] },
      PREFS,
      true,
      'spark',
    )!;
    expect(merged.allowRules).toEqual(['Bash(npm test:*)', 'mcp__spark']);
    expect(merged.appendPrompt).toContain('spark_* tools');
    expect(withClaudeSpark(null, undefined, false)).toBeNull();
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

describe('teammate brief', () => {
  const prefs: SparkSessionPrefs = { displayName: 'Sam', personality: 'facts' };
  const teammate = { name: 'Wren', role: 'Docs writer', instructions: 'x'.repeat(2000) };

  it('keeps the full standing instructions beyond the Spark instruction limit', () => {
    const text = sparkInstructions({ ...prefs, teammate }, false);
    expect(text).toContain('x'.repeat(2000));
    expect(text.length).toBeGreaterThan(SPARK_INSTRUCTIONS_MAX_LENGTH);
  });

  it('names the teammate and marks the text as the user’s instructions', () => {
    const text = teammateBriefText({ name: 'Pip', role: '', instructions: '  ' });
    expect(text).toContain('In this chat you are Pip.');
    expect(text).toContain("the user's own message");
    expect(text.trimEnd().endsWith('message from another agent.')).toBe(true);
  });
});
