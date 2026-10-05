import { describe, expect, it } from 'vitest';
import { nearestUsable } from './nearest.ts';

const NOW = new Date('2026-10-05T00:00:00Z');
const model = (id: string, label: string, availability: 'usable' | 'unknown' | 'unusable') => ({
  id,
  label,
  availability,
});
const SOL_61 = { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' };
const LUNA = model('gpt-6-luna', '6 Luna', 'usable');
const SOL = model('gpt-6-sol', '6 Sol', 'usable');
const TERRA = model('gpt-5.6-terra', 'GPT-5.6 Terra', 'usable');
const SOL_56 = model('gpt-5.6-sol', 'GPT-5.6 Sol', 'usable');
const ASTRA = model('gpt-6-astra', '6 Astra', 'usable');

const nearest = (target: { id: string; label: string }, pool: (typeof LUNA)[]) =>
  nearestUsable(target, pool, 'codex', NOW)?.id ?? null;

describe('the nearest usable model', () => {
  it('maps a rejected model to the usable model of the same tier', () => {
    expect(nearest(SOL_61, [LUNA, TERRA, SOL, SOL_56, ASTRA])).toBe('gpt-6-sol');
  });

  it('prefers the same family when two models share the tier', () => {
    expect(nearest(SOL_61, [TERRA, SOL])).toBe('gpt-6-sol');
    expect(nearest(SOL_61, [SOL, TERRA])).toBe('gpt-6-sol');
  });

  it('never returns the model itself or one marked unusable', () => {
    const pool = [
      model('gpt-6.1-sol', 'GPT-6.1 Sol', 'usable'),
      { ...SOL, availability: 'unusable' as const },
      LUNA,
    ];
    expect(nearest(SOL_61, pool)).toBe('gpt-6-luna');
  });

  it('steps down before it steps up when no model shares the tier', () => {
    expect(nearest(SOL_61, [LUNA, SOL_56])).toBe('gpt-6-luna');
  });

  it('keeps off the frontier tier unless the rejected model was frontier', () => {
    expect(nearest(SOL_56, [LUNA, ASTRA])).toBe('gpt-6-luna');
    expect(nearest({ id: 'gpt-6-astra', label: '6 Astra' }, [LUNA, SOL_56])).toBe('gpt-5.6-sol');
    expect(nearest(SOL_56, [ASTRA])).toBe('gpt-6-astra');
  });

  it('prefers a confirmed model over one with unknown availability', () => {
    const unknownSol = model('gpt-6-sol', '6 Sol', 'unknown');
    expect(nearest(SOL_61, [unknownSol, LUNA])).toBe('gpt-6-luna');
    expect(nearest(SOL_61, [unknownSol])).toBe('gpt-6-sol');
  });

  it('skips retired models and reports nothing when nothing is left', () => {
    const retired = model('gpt-5.5', 'GPT-5.5', 'usable');
    expect(nearestUsable(SOL_56, [retired], 'codex', new Date('2026-12-01T00:00:00Z'))).toBeNull();
    expect(nearest(SOL_61, [])).toBeNull();
  });

  it('still picks a model when the rejected one has no known tier', () => {
    expect(nearest({ id: 'mystery-9', label: 'Mystery 9' }, [LUNA, SOL])).toBe('gpt-6-luna');
  });
});
