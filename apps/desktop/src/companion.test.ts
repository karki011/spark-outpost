import { describe, expect, it, vi } from 'vitest';
import { createCompanion, SHORTCUT_TAKEN, type CompanionEffects } from './companion.ts';
import { DEFAULT_SETTINGS, type CompanionSettings } from './companion-settings.ts';

function setup(initial: Partial<CompanionSettings> = {}, taken: string[] = []) {
  const registered = new Map<string, () => void>();
  const islands: { destroy: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> }[] = [];
  const gone: (() => void)[] = [];
  const effects = {
    supported: true,
    openIsland: vi.fn((onGone: () => void) => {
      const island = { destroy: vi.fn(), command: vi.fn() };
      islands.push(island);
      gone.push(onGone);
      return island;
    }),
    register: vi.fn((accelerator: string, run: () => void) => {
      if (taken.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, run);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => registered.delete(accelerator)),
    save: vi.fn(),
    changed: vi.fn(),
  } satisfies CompanionEffects;
  const companion = createCompanion(
    { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts }, ...initial },
    effects,
  );
  return { companion, effects, registered, islands, gone };
}

describe('desktop companion lifecycle', () => {
  it('stays off by default: no island window and no global shortcuts', () => {
    const { companion, effects, registered } = setup();
    expect(companion.running()).toBe(false);
    expect(effects.openIsland).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it('turning it on opens the island and registers both shortcuts live', () => {
    const { companion, registered, islands, effects } = setup();
    const status = companion.setEnabled(true);
    expect(status.enabled).toBe(true);
    expect(islands).toHaveLength(1);
    expect([...registered.keys()]).toEqual(['Alt+Space', 'Alt+Shift+Space']);
    expect(effects.save).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(effects.changed).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));

    registered.get('Alt+Shift+Space')!();
    expect(islands[0]!.command).toHaveBeenCalledWith('sessions');
  });

  it('turning it off destroys the window and unregisters the shortcuts', () => {
    const { companion, registered, islands } = setup({ enabled: true });
    expect(islands).toHaveLength(1);
    companion.setEnabled(false);
    expect(islands[0]!.destroy).toHaveBeenCalledOnce();
    expect(registered.size).toBe(0);
    expect(companion.running()).toBe(false);

    companion.setEnabled(true);
    expect(islands).toHaveLength(2);
    expect(registered.size).toBe(2);
  });

  it('reports a shortcut another app holds without failing the rest', () => {
    const { companion, registered } = setup({ enabled: true }, ['Alt+Space']);
    expect(companion.status().failed).toEqual(['quick']);
    expect([...registered.keys()]).toEqual(['Alt+Shift+Space']);
  });

  it('changes a shortcut live and keeps the old one when the new one is taken', () => {
    const { companion, registered } = setup({ enabled: true }, ['Alt+K']);
    expect(companion.setShortcut('quick', 'Control+Alt+J')).toEqual({ ok: true });
    expect(registered.has('Control+Alt+J')).toBe(true);
    expect(registered.has('Alt+Space')).toBe(false);

    expect(companion.setShortcut('quick', 'Alt+K')).toEqual({ ok: false, error: SHORTCUT_TAKEN });
    expect(registered.has('Control+Alt+J')).toBe(true);
    expect(companion.status().shortcuts.quick).toBe('Control+Alt+J');

    expect(companion.setShortcut('quick', null)).toEqual({ ok: true });
    expect(companion.status().shortcuts.quick).toBe('Alt+Space');
  });

  it('refuses invalid or duplicate shortcuts', () => {
    const { companion } = setup();
    expect(companion.setShortcut('quick', 'Space').ok).toBe(false);
    expect(companion.setShortcut('quick', 'Alt+Shift+Space')).toEqual({
      ok: false,
      error: 'That shortcut already opens Sessions.',
    });
  });

  it('saves a changed shortcut while off without registering it', () => {
    const { companion, registered } = setup();
    expect(companion.setShortcut('sessions', 'Alt+S')).toEqual({ ok: true });
    expect(registered.size).toBe(0);
    companion.setEnabled(true);
    expect(registered.has('Alt+S')).toBe(true);
  });

  it('shuts down cleanly and notices a window that went away on its own', () => {
    const { companion, registered, islands, gone } = setup({ enabled: true });
    gone[0]!();
    expect(companion.running()).toBe(false);
    companion.setEnabled(true);
    companion.shutdown();
    expect(islands.at(-1)!.destroy).toHaveBeenCalledOnce();
    expect(registered.size).toBe(0);
  });

  it('never opens on platforms without the island', () => {
    const { companion, effects } = setup({ enabled: true });
    expect(effects.openIsland).toHaveBeenCalledOnce();
    const other = createCompanion(
      { ...DEFAULT_SETTINGS, enabled: true },
      { ...effects, supported: false },
    );
    expect(other.running()).toBe(false);
    expect(other.setEnabled(true).enabled).toBe(false);
    expect(companion.running()).toBe(true);
  });
});
