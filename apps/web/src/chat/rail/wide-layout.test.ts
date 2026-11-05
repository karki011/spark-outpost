import { describe, expect, it } from 'vitest';
import { panelOpensByDefault, railState } from './wide-layout.ts';

const base = { roomy: true, panelOpen: false, layout: 'rail', collapsed: false, turns: 4 } as const;

describe('railState', () => {
  it('shows the rail in a roomy chat with the work panel closed', () => {
    expect(railState(base)).toBe('open');
  });

  it('keeps only the toggle once the user collapsed it', () => {
    expect(railState({ ...base, collapsed: true })).toBe('collapsed');
  });

  it('hides in a narrow window, beside the open work panel and in an empty chat', () => {
    expect(railState({ ...base, roomy: false })).toBe('hidden');
    expect(railState({ ...base, panelOpen: true })).toBe('hidden');
    expect(railState({ ...base, turns: 0 })).toBe('hidden');
  });

  it('hides when the setting asks for the work panel or an empty margin', () => {
    expect(railState({ ...base, layout: 'panel' })).toBe('hidden');
    expect(railState({ ...base, layout: 'empty' })).toBe('hidden');
  });
});

describe('panelOpensByDefault', () => {
  it('leaves narrower windows as they were: the panel opens', () => {
    expect(panelOpensByDefault(false, 'rail')).toBe(true);
    expect(panelOpensByDefault(false, 'empty')).toBe(true);
  });

  it('opens the panel on a wide window only when the setting says so', () => {
    expect(panelOpensByDefault(true, 'panel')).toBe(true);
    expect(panelOpensByDefault(true, 'rail')).toBe(false);
    expect(panelOpensByDefault(true, 'empty')).toBe(false);
  });
});
