import { describe, expect, it } from 'vitest';
import { ASK_SPARK_FAST_TIER, assistantPick, fastModelFor } from './assistant-model.ts';
import { cardById } from '../model-cards/cards.ts';

const CLAUDE = [
  { id: 'default', label: 'Default (recommended)' },
  { id: 'sonnet', label: 'Sonnet 5.5' },
  { id: 'opus[1m]', label: 'Opus 5.5' },
];
const CODEX = [
  { id: 'gpt-6-sol', label: '6 Sol' },
  { id: 'gpt-6-luna', label: '6 Luna' },
];
const ZAI = [
  { id: 'glm-5.3', label: 'GLM-5.3' },
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash' },
];
const EFFORTS = ['low', 'medium', 'high'];
const FAST = { modelChoice: 'fast', model: null, effort: null } as const;

describe('Ask Spark fast tier', () => {
  it('names a model card Spark knows for every provider with fixed models', () => {
    for (const tier of Object.values(ASK_SPARK_FAST_TIER)) {
      if (tier) expect(cardById(tier.card)).not.toBeNull();
    }
  });

  it('has no fast tier for a custom endpoint, so Ask Spark keeps its default model', () => {
    const offered = [{ id: 'opus', label: 'qwen3-coder' }];
    expect(fastModelFor('custom', offered)).toBeNull();
    expect(assistantPick(FAST, 'custom', offered, ['low', 'high'])).toEqual({
      model: null,
      effort: null,
      fastEffort: null,
      noFastModel: true,
    });
  });

  it('runs Claude on Sonnet 5.5 at low effort, found through the alias Claude offers', () => {
    expect(fastModelFor('claude', CLAUDE)?.id).toBe('sonnet');
    expect(assistantPick(FAST, 'claude', CLAUDE, EFFORTS)).toEqual({
      model: 'sonnet',
      effort: 'low',
      fastEffort: 'low',
      noFastModel: false,
    });
  });

  it('runs Codex on 6 Luna and Z.ai on GLM-5.3-Flash, both at low effort', () => {
    expect(assistantPick(FAST, 'codex', CODEX, EFFORTS)).toMatchObject({
      model: 'gpt-6-luna',
      effort: 'low',
    });
    expect(assistantPick(FAST, 'zai', ZAI, ['low', 'high', 'max'])).toMatchObject({
      model: 'glm-5.3-flash',
      effort: 'low',
    });
  });

  it('keeps the default model and says so when the provider offers no fast model', () => {
    const older = [{ id: 'sonnet', label: 'Sonnet 5' }];
    expect(assistantPick(FAST, 'claude', older, EFFORTS)).toEqual({
      model: null,
      effort: 'low',
      fastEffort: 'low',
      noFastModel: true,
    });
  });

  it('drops an effort the provider does not offer', () => {
    expect(assistantPick(FAST, 'claude', CLAUDE, ['medium', 'high'])).toMatchObject({
      model: 'sonnet',
      effort: null,
      fastEffort: null,
    });
    expect(assistantPick({ ...FAST, effort: 'max' }, 'claude', CLAUDE, EFFORTS).effort).toBe('low');
  });

  it('lets a picked effort replace the fast default', () => {
    expect(assistantPick({ ...FAST, effort: 'high' }, 'claude', CLAUDE, EFFORTS).effort).toBe(
      'high',
    );
  });

  it('follows the chat default when asked, and a picked model only while it is offered', () => {
    expect(
      assistantPick(
        { modelChoice: 'default', model: null, effort: null },
        'claude',
        CLAUDE,
        EFFORTS,
      ),
    ).toEqual({ model: null, effort: null, fastEffort: 'low', noFastModel: false });
    const picked = { modelChoice: 'pick', model: 'opus[1m]', effort: 'medium' } as const;
    expect(assistantPick(picked, 'claude', CLAUDE, EFFORTS)).toMatchObject({
      model: 'opus[1m]',
      effort: 'medium',
    });
    expect(assistantPick(picked, 'codex', CODEX, EFFORTS).model).toBeNull();
  });
});
