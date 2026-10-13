import { ipcMain } from 'electron';
import { saveTheme } from './appearance.ts';
import { IPC } from './ipc-channels.ts';
import { isThemeName } from './theme-arg.ts';

interface ThemeListener {
  file: string;
  trusted(senderUrl: string): boolean;
  saved(): string | null;
  remember(theme: string): void;
  log(line: string): void;
}

export function listenForTheme(options: ThemeListener): void {
  let saving = Promise.resolve();
  ipcMain.on(IPC.themeSave, (event, theme: unknown) => {
    if (!options.trusted(event.senderFrame?.url ?? '') || !isThemeName(theme)) return;
    if (theme === options.saved()) return;
    options.remember(theme);
    saving = saving
      .then(() => saveTheme(options.file, theme))
      .catch((error: Error) => options.log(`Could not save the theme: ${error.message}`));
  });
}
