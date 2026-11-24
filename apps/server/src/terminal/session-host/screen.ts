import { createRequire } from 'node:module';
import type * as XtermHeadless from '@xterm/headless';

const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof XtermHeadless;

export interface ScreenModel {
  write(text: string): void;
  resize(cols: number, rows: number): void;
  text(): Promise<string>;
  dispose(): void;
}

export function headlessScreen(cols: number, rows: number): ScreenModel {
  const terminal = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  return {
    write: (text) => terminal.write(text),
    resize: (c, r) => terminal.resize(c, r),
    text: () =>
      new Promise((resolve) => {
        terminal.write('', () => {
          const buffer = terminal.buffer.active;
          const lines: string[] = [];
          for (let y = buffer.baseY; y < buffer.baseY + terminal.rows; y += 1) {
            const line = buffer.getLine(y);
            if (!line) continue;
            const row = line.translateToString(true);
            if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += row;
            else lines.push(row);
          }
          resolve(lines.join('\n'));
        });
      }),
    dispose: () => terminal.dispose(),
  };
}
