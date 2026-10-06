import {
  DEFAULT_SHORTCUTS,
  isAccelerator,
  SHORTCUT_ACTIONS,
  type CompanionSettings,
  type IslandPosition,
  type IslandSize,
  type ShortcutAction,
} from './companion-settings.ts';

export interface IslandHandle {
  destroy(): void;
  command(action: ShortcutAction): void;
}

export interface CompanionStatus {
  supported: boolean;
  enabled: boolean;
  shortcuts: Record<ShortcutAction, string>;
  failed: ShortcutAction[];
  sound: boolean;
  islandSize: IslandSize;
  autoExpand: boolean;
}

export type ShortcutResult = { ok: true } | { ok: false; error: string };

export interface CompanionEffects {
  supported: boolean;
  openIsland: (onGone: () => void) => IslandHandle;
  register: (accelerator: string, run: () => void) => boolean;
  unregister: (accelerator: string) => void;
  save: (settings: CompanionSettings) => void;
  changed: (status: CompanionStatus) => void;
}

export interface Companion {
  resume(): void;
  status(): CompanionStatus;
  running(): boolean;
  position(): IslandPosition;
  setEnabled(on: boolean): CompanionStatus;
  setShortcut(action: ShortcutAction, accelerator: string | null): ShortcutResult;
  setSound(on: boolean): CompanionStatus;
  setIslandSize(size: IslandSize): CompanionStatus;
  setAutoExpand(on: boolean): CompanionStatus;
  setPosition(position: IslandPosition): void;
  shutdown(): void;
}

const ACTION_NAMES: Record<ShortcutAction, string> = {
  quick: 'Quick chat',
  sessions: 'Sessions',
};

export const SHORTCUT_TAKEN = 'Another app is using this shortcut. Pick a different one.';
export const SHORTCUT_INVALID = 'Use at least one modifier key with a letter, number or Space.';

export function createCompanion(initial: CompanionSettings, effects: CompanionEffects): Companion {
  let settings = initial;
  let island: IslandHandle | null = null;
  const active = new Map<ShortcutAction, string>();
  const failed = new Set<ShortcutAction>();

  const status = (): CompanionStatus => ({
    supported: effects.supported,
    enabled: effects.supported && settings.enabled,
    shortcuts: { ...settings.shortcuts },
    failed: SHORTCUT_ACTIONS.filter((action) => failed.has(action)),
    sound: settings.sound,
    islandSize: settings.islandSize,
    autoExpand: settings.autoExpand,
  });

  const publish = () => effects.changed(status());

  const commit = (next: CompanionSettings) => {
    settings = next;
    effects.save(settings);
  };

  const tryRegister = (action: ShortcutAction, accelerator: string): boolean => {
    if (!effects.register(accelerator, () => island?.command(action))) return false;
    active.set(action, accelerator);
    failed.delete(action);
    return true;
  };

  const bind = (action: ShortcutAction) => {
    if (!tryRegister(action, settings.shortcuts[action])) failed.add(action);
  };

  const unbind = (action: ShortcutAction) => {
    const accelerator = active.get(action);
    if (accelerator) effects.unregister(accelerator);
    active.delete(action);
    failed.delete(action);
  };

  const start = () => {
    if (island) return;
    const handle = effects.openIsland(() => {
      if (island === handle) island = null;
    });
    island = handle;
    SHORTCUT_ACTIONS.forEach(bind);
  };

  const stop = () => {
    SHORTCUT_ACTIONS.forEach(unbind);
    const handle = island;
    island = null;
    handle?.destroy();
  };

  return {
    resume() {
      if (effects.supported && settings.enabled) start();
    },
    status,
    running: () => island !== null,
    position: () => settings.position,
    setEnabled(on) {
      if (!effects.supported) return status();
      commit({ ...settings, enabled: on });
      if (on) start();
      else stop();
      publish();
      return status();
    },
    setShortcut(action, accelerator) {
      const next = accelerator ?? DEFAULT_SHORTCUTS[action];
      if (!isAccelerator(next)) return { ok: false, error: SHORTCUT_INVALID };
      const clash = SHORTCUT_ACTIONS.find(
        (other) => other !== action && settings.shortcuts[other] === next,
      );
      if (clash) return { ok: false, error: `This shortcut already opens ${ACTION_NAMES[clash]}.` };
      if (island && active.get(action) !== next) {
        const previous = active.get(action);
        unbind(action);
        if (!tryRegister(action, next)) {
          if (!previous || !tryRegister(action, previous)) failed.add(action);
          publish();
          return { ok: false, error: SHORTCUT_TAKEN };
        }
      }
      commit({ ...settings, shortcuts: { ...settings.shortcuts, [action]: next } });
      publish();
      return { ok: true };
    },
    setSound(on) {
      commit({ ...settings, sound: on });
      publish();
      return status();
    },
    setIslandSize(size) {
      commit({ ...settings, islandSize: size, islandSizePicked: true });
      publish();
      return status();
    },
    setAutoExpand(on) {
      commit({ ...settings, autoExpand: on });
      publish();
      return status();
    },
    setPosition(position) {
      commit({ ...settings, position });
    },
    shutdown: stop,
  };
}
