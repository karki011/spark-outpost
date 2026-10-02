import { describe, expect, it } from 'vitest';
import { reportedModel } from './reported-model.ts';

describe('reportedModel', () => {
  it('resolves Z.ai Claude aliases to the GLM model behind them', () => {
    expect(reportedModel('zai', 'opus')).toEqual({ model: 'glm-5.3', modelLabel: 'GLM-5.3' });
    expect(reportedModel('zai', 'sonnet')).toEqual({ model: 'glm-5.3', modelLabel: 'GLM-5.3' });
    expect(reportedModel('zai', 'default')).toEqual({ model: 'glm-5.3', modelLabel: 'GLM-5.3' });
    expect(reportedModel('zai', 'haiku')).toEqual({
      model: 'glm-5.3-flash',
      modelLabel: 'GLM-5.3-Flash',
    });
  });

  it('labels Z.ai ids that are already resolved', () => {
    expect(reportedModel('zai', 'glm-5.3')).toEqual({ model: 'glm-5.3', modelLabel: 'GLM-5.3' });
    expect(reportedModel('zai', 'glm-5.3-flash[1m]')).toEqual({
      model: 'glm-5.3-flash',
      modelLabel: 'GLM-5.3-Flash',
    });
  });

  it('keeps unknown Z.ai models, missing models and other providers as they are', () => {
    expect(reportedModel('zai', 'glm-9')).toEqual({ model: 'glm-9' });
    expect(reportedModel('zai', null)).toEqual({ model: null });
    expect(reportedModel('claude', 'opus')).toEqual({ model: 'opus' });
    expect(reportedModel(null, 'opus')).toEqual({ model: 'opus' });
  });
});
