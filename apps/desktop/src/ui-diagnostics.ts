import type { BrowserWindow } from 'electron';

const SELECTORS = [
  '.set',
  '.dlg',
  '.fdlg-scrim',
  '.op-scrim',
  '.tm-scrim',
  '.cx-confirm-scrim',
  '.cal-choose-scrim',
  '.wp-scrim',
  '.scrim',
  '.tv-dim',
  '[role="dialog"]',
  '[role="alertdialog"]',
  'dialog',
  '[inert]',
];

export const UI_DIAGNOSTICS_SCRIPT = `(() => {
  const selectors = ${JSON.stringify(SELECTORS)};
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

const pending = new WeakSet<object>();
const DISPLAY = new Set([
  'none',
  'contents',
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'flow-root',
  'table',
  'inline-table',
  'table-row',
  'table-cell',
  'table-caption',
  'table-row-group',
  'table-column',
  'table-column-group',
  'table-header-group',
  'table-footer-group',
  'list-item',
]);
const POINTER_EVENTS = new Set([
  'auto',
  'none',
  'visiblePainted',
  'visibleFill',
  'visibleStroke',
  'visible',
  'painted',
  'fill',
  'stroke',
  'all',
  'bounding-box',
]);

function object(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const found = Object.keys(value);
  if (found.length !== keys.length || found.some((key) => !keys.includes(key))) return null;
  return value as Record<string, unknown>;
}

function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  if (
    !value.every(
      (item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1000000,
    )
  )
    return null;
  return [...value] as number[];
}

function describe(value: unknown) {
  const item = object(value, [
    'selectors',
    'display',
    'visibility',
    'opacity',
    'pointerEvents',
    'rect',
    'hiddenAncestor',
    'modal',
  ]);
  if (
    !item ||
    !Array.isArray(item.selectors) ||
    item.selectors.length > SELECTORS.length ||
    !item.selectors.every(
      (selector) => typeof selector === 'string' && SELECTORS.includes(selector),
    ) ||
    typeof item.display !== 'string' ||
    !DISPLAY.has(item.display) ||
    typeof item.visibility !== 'string' ||
    !['visible', 'hidden', 'collapse'].includes(item.visibility) ||
    typeof item.pointerEvents !== 'string' ||
    !POINTER_EVENTS.has(item.pointerEvents) ||
    typeof item.opacity !== 'string' ||
    item.opacity.length > 16 ||
    !/^(0(?:\.\d+)?|1(?:\.0+)?)$/.test(item.opacity) ||
    typeof item.hiddenAncestor !== 'boolean' ||
    typeof item.modal !== 'boolean'
  )
    return null;
  const rect = numbers(item.rect, 4);
  if (!rect) return null;
  return {
    selectors: [...item.selectors] as string[],
    display: item.display,
    visibility: item.visibility,
    opacity: item.opacity,
    pointerEvents: item.pointerEvents,
    rect,
    hiddenAncestor: item.hiddenAncestor,
    modal: item.modal,
  };
}

function safeSnapshot(value: unknown) {
  const item = object(value, ['viewport', 'overlays', 'hitTests', 'truncated']);
  if (
    !item ||
    !Array.isArray(item.overlays) ||
    item.overlays.length > 24 ||
    !Array.isArray(item.hitTests) ||
    item.hitTests.length > 9 ||
    typeof item.truncated !== 'boolean'
  )
    return null;
  const viewport = numbers(item.viewport, 2);
  const overlays = item.overlays.map(describe);
  if (!viewport || overlays.some((overlay) => !overlay)) return null;
  const hitTests = [];
  for (const hit of item.hitTests) {
    const row = object(hit, ['point', 'target', 'blocker']);
    if (!row) return null;
    const point = numbers(row.point, 2);
    const target = row.target === null ? null : describe(row.target);
    const blocker = row.blocker === null ? null : describe(row.blocker);
    if (
      !point ||
      point.some((coordinate) => ![0.1, 0.5, 0.9].includes(coordinate)) ||
      (row.target !== null && !target) ||
      (row.blocker !== null && !blocker)
    )
      return null;
    hitTests.push({ point, target, blocker });
  }
  return { viewport, overlays, hitTests, truncated: item.truncated };
}

export async function recordUiDiagnostics(
  windows: readonly { kind: 'main' | 'settings'; window: BrowserWindow | null }[],
  origin: string,
  log: (line: string) => void,
): Promise<void> {
  await Promise.all(
    windows.slice(0, 2).map(async ({ kind, window }) => {
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      try {
        const url = new URL(window.webContents.getURL());
        if (
          url.origin !== new URL(origin).origin ||
          url.pathname !== (kind === 'main' ? '/' : '/settings')
        )
          return;
        const contents = window.webContents;
        if (pending.has(contents)) {
          log(`[ui-diagnostics] ${kind} unavailable`);
          return;
        }
        pending.add(contents);
        let collection: Promise<unknown>;
        try {
          collection = contents
            .executeJavaScript(UI_DIAGNOSTICS_SCRIPT)
            .finally(() => pending.delete(contents));
        } catch (error) {
          pending.delete(contents);
          throw error;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            collection,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), 1500);
            }),
          ]);
          const safe = safeSnapshot(result);
          log(`[ui-diagnostics] ${kind} ${safe ? JSON.stringify(safe) : 'unavailable'}`);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        log(`[ui-diagnostics] ${kind} unavailable`);
      }
    }),
  );
}
