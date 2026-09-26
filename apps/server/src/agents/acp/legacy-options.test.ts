import type { NewSessionResponse } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { LEGACY_MODE_OPTION, legacyOptions } from './legacy-options.ts';

describe('legacy session modes and models', () => {
  it('turns legacy modes into a mode option and skips malformed shapes', () => {
    const response = {
      sessionId: 's',
      modes: {
        currentModeId: 'ask',
        availableModes: [{ id: 'ask', name: 'Ask', description: 'Asks first' }],
      },
      models: { currentModelId: 7, availableModels: [] },
    } as unknown as NewSessionResponse;
    expect(legacyOptions(response)).toEqual([
      {
        id: LEGACY_MODE_OPTION,
        name: 'mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask', description: 'Asks first' }],
      },
    ]);
  });
});
