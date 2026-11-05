export const ESCAPE = 'Escape';

export interface EscapeKeys {
  register(accelerator: string, run: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface EscapeGuard {
  arm(on: boolean): void;
  armed(): boolean;
}

export function escapeGuard(keys: EscapeKeys, onEscape: () => void): EscapeGuard {
  let armed = false;
  return {
    arm: (on) => {
      if (on === armed) return;
      if (on) {
        try {
          armed = keys.register(ESCAPE, onEscape);
        } catch {
          armed = false;
        }
        return;
      }
      keys.unregister(ESCAPE);
      armed = false;
    },
    armed: () => armed,
  };
}
