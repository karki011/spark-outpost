import { describe, expect, it } from 'vitest';
import { openByDefault, screenState, type SectionId } from './section-state.ts';
import type { TileStatus } from './tile-status.ts';

const SECTIONS: SectionId[] = ['connect', 'test', 'defaults', 'danger'];
const status = (tone: TileStatus['tone'], label: string): TileStatus => ({ tone, label, hint: '' });
const opened = (state: ReturnType<typeof screenState>, tileStatus: TileStatus) =>
  SECTIONS.filter((section) => openByDefault(section, state, tileStatus));

describe('provider screen sections', () => {
  it('opens only How to connect until the provider is connected', () => {
    const notSetUp = status('off', 'Not set up');
    expect(opened(screenState(false, notSetUp), notSetUp)).toEqual(['connect']);
  });

  it('starts collapsed when a connected provider is healthy', () => {
    const ok = status('ok', 'Connected · Local CLI');
    expect(opened(screenState(true, ok), ok)).toEqual([]);
  });

  it('opens the section with the problem', () => {
    const signIn = status('warn', 'Needs sign-in');
    expect(opened(screenState(true, signIn), signIn)).toEqual(['connect']);
    const error = status('bad', 'Error');
    expect(opened(screenState(true, error), error)).toEqual(['test']);
  });
});
