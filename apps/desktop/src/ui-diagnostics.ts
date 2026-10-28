import type { BrowserWindow } from 'electron';

export const UI_DIAGNOSTICS_SCRIPT = `(() => {
  const selectors = ['.set', '.dlg', '.fdlg-scrim', '.op-scrim', '.tm-scrim',
    '.cx-confirm-scrim', '.cal-choose-scrim', '.wp-scrim', '.scrim', '.tv-dim',
    '[role="dialog"]', '[role="alertdialog"]', 'dialog', '[inert]'];
  const identify = (element) => selectors.filter((selector) => element.matches(selector));
  const describe = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      selectors: identify(element),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
      hiddenAncestor: Boolean(element.closest('[hidden], [inert]')),
      modal: element.matches(':modal'),
    };
  };
  const candidates = [...document.querySelectorAll(selectors.join(','))];
  const overlays = candidates.filter((element) => element.getClientRects().length > 0)
    .slice(0, 24).map(describe);
  const hitTests = [];
  for (const x of [0.1, 0.5, 0.9]) for (const y of [0.1, 0.5, 0.9]) {
    const target = document.elementFromPoint(innerWidth * x, innerHeight * y);
    const blocker = target?.closest(selectors.join(','));
    hitTests.push({ point: [x, y], target: target ? describe(target) : null,
      blocker: blocker ? describe(blocker) : null });
  }
  return { viewport: [innerWidth, innerHeight], overlays, hitTests,
    truncated: candidates.length > 24 };
})()`;

export async function recordUiDiagnostics(
  windows: readonly { kind: 'main' | 'settings'; window: BrowserWindow | null }[],
  origin: string,
  log: (line: string) => void,
): Promise<void> {
  await Promise.all(
    windows.map(async ({ kind, window }) => {
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      try {
        const url = new URL(window.webContents.getURL());
        if (
          url.origin !== new URL(origin).origin ||
          url.pathname !== (kind === 'main' ? '/' : '/settings')
        )
          return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            window.webContents.executeJavaScript(UI_DIAGNOSTICS_SCRIPT),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), 1500);
            }),
          ]);
          log(
            `[ui-diagnostics] ${kind} ${result === null ? 'unavailable' : JSON.stringify(result)}`,
          );
        } finally {
          clearTimeout(timer);
        }
      } catch {
        log(`[ui-diagnostics] ${kind} unavailable`);
      }
    }),
  );
}
