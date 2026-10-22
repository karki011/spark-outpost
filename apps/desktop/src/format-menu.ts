import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import { IPC } from './ipc-channels.ts';

type MenuClick = NonNullable<MenuItemConstructorOptions['click']>;

interface CommandTarget {
  send(channel: string, command: string): void;
}

function sendCommand(command: string): MenuClick {
  return (_item, window: BaseWindow | undefined) => {
    if (!window || !('webContents' in window)) return;
    (window.webContents as CommandTarget).send(IPC.menuCommand, command);
  };
}

export function formatMenu(): MenuItemConstructorOptions {
  return {
    label: 'Format',
    submenu: [
      {
        label: 'Bold',
        accelerator: 'CommandOrControl+B',
        registerAccelerator: false,
        click: sendCommand('format:bold'),
      },
      {
        label: 'Italic',
        accelerator: 'CommandOrControl+I',
        registerAccelerator: false,
        click: sendCommand('format:italic'),
      },
      {
        label: 'Strikethrough',
        accelerator: 'Shift+CommandOrControl+X',
        registerAccelerator: false,
        click: sendCommand('format:strike'),
      },
      { label: 'Code', click: sendCommand('format:code') },
      { type: 'separator' },
      { label: 'Add Link…', click: sendCommand('format:link') },
    ],
  };
}
