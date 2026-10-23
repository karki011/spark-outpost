import type { MenuItemConstructorOptions } from 'electron';

export interface MenuBarTray {
  setMenu(template: MenuItemConstructorOptions[]): void;
  destroy(): void;
}

export interface MenuBarItem {
  update(shown: boolean, template: MenuItemConstructorOptions[]): void;
  dispose(): void;
}

export function menuBarItem(create: () => MenuBarTray): MenuBarItem {
  let tray: MenuBarTray | null = null;

  const remove = () => {
    tray?.destroy();
    tray = null;
  };

  return {
    update(shown, template) {
      if (!shown) {
        remove();
        return;
      }
      tray ??= create();
      tray.setMenu(template);
    },
    dispose: remove,
  };
}
