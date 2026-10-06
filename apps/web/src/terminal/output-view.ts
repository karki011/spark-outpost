import type * as XtermOutput from './xterm-output.ts';
import type { OutputView } from './xterm-output.ts';

export type { OutputView };

let loading: Promise<typeof XtermOutput> | null = null;

function loadOutputView(): Promise<typeof XtermOutput> {
  loading ??= import('./xterm-output.ts');
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export function mountOutputView(element: HTMLElement, onFailed: () => void): OutputView {
  let opened: OutputView | null = null;
  let disposed = false;
  let waiting: ((view: OutputView) => void)[] = [];

  loadOutputView().then(
    (xterm) => {
      if (disposed) return;
      opened = xterm.openOutputView(element);
      for (const call of waiting) call(opened);
      waiting = [];
    },
    () => {
      if (!disposed) onFailed();
    },
  );

  const whenOpen = (call: (view: OutputView) => void) => {
    if (opened) call(opened);
    else if (!disposed) waiting.push(call);
  };

  return {
    write: (text) => whenOpen((view) => view.write(text)),
    replace: (text) => whenOpen((view) => view.replace(text)),
    scrollLines: (lines) => whenOpen((view) => view.scrollLines(lines)),
    scrollPages: (pages) => whenOpen((view) => view.scrollPages(pages)),
    scrollToEnd: () => whenOpen((view) => view.scrollToEnd()),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      waiting = [];
      opened?.dispose();
    },
  };
}
