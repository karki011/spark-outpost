import { FitAddon } from '@xterm/addon-fit';
import { createOutputSanitizer } from '@spark-outpost/contracts';
import { createTerminal, followTheme } from './xterm-terminal.ts';

const MIN_COLS = 80;
const MIN_ROWS = 2;
const SCROLLBACK_LINES = 2000;
const HIDE_CURSOR = '\u001b[?25l';

export interface OutputView {
  write(text: string): void;
  replace(text: string): void;
  scrollLines(lines: number): void;
  scrollPages(pages: number): void;
  scrollToEnd(): void;
  dispose(): void;
}

export function openOutputView(element: HTMLElement): OutputView {
  const terminal = createTerminal({
    disableStdin: true,
    cursorBlink: false,
    screenReaderMode: false,
    convertEol: true,
    scrollback: SCROLLBACK_LINES,
    linkHandler: null,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  terminal.write(HIDE_CURSOR);
  if (terminal.textarea) {
    terminal.textarea.tabIndex = -1;
    terminal.textarea.setAttribute('aria-hidden', 'true');
  }
  let sanitizer = createOutputSanitizer();

  const size = () => {
    const proposed = fit.proposeDimensions();
    if (!proposed || Number.isNaN(proposed.cols) || Number.isNaN(proposed.rows)) return;
    const cols = Math.max(MIN_COLS, proposed.cols);
    const rows = Math.max(MIN_ROWS, proposed.rows);
    if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
  };
  size();
  const resizeObserver = new ResizeObserver(size);
  resizeObserver.observe(element);
  const unfollowTheme = followTheme(terminal);

  return {
    write: (text) => terminal.write(sanitizer.push(text)),
    replace: (text) => {
      sanitizer = createOutputSanitizer();
      terminal.reset();
      terminal.write(HIDE_CURSOR + sanitizer.push(text));
    },
    scrollLines: (lines) => terminal.scrollLines(lines),
    scrollPages: (pages) => terminal.scrollPages(pages),
    scrollToEnd: () => terminal.scrollToBottom(),
    dispose: () => {
      resizeObserver.disconnect();
      unfollowTheme();
      terminal.dispose();
    },
  };
}
