export const PAGE_MIN_WIDTH = 320;
export const CHAT_MIN_WIDTH = 300;
export const PAGE_WIDTH_PRESETS = [320, 390, 768, 1024, 1280] as const;
export const PANE_STEP = 10;
export const PANE_BIG_STEP = 50;

export interface PaneRange {
  min: number;
  max: number;
}

export interface DockedRow {
  rowRight: number;
  chatLeft: number;
  gaps: number;
}

export function dockedRoom(row: DockedRow): number {
  return Math.floor(row.rowRight - row.chatLeft - row.gaps - CHAT_MIN_WIDTH);
}

export function overlayRoom(viewport: number, gaps: number): number {
  return Math.floor(viewport - gaps);
}

export function paneRange(room: number, inset: number, zoom = 1): PaneRange {
  const min = Math.ceil(PAGE_MIN_WIDTH / zoom) + inset;
  return { min, max: Math.max(min, room) };
}

export function pageWidth(pane: number, inset: number, zoom: number): number {
  return Math.round((pane - inset) * zoom);
}

function paneWidthFor(page: number, inset: number, zoom: number): number {
  return Math.round(page / zoom) + inset;
}

export function shownPaneWidth(width: number, range: PaneRange): number {
  return Math.round(Math.min(range.max, Math.max(range.min, width)));
}

export type PresetFit = { ok: true; width: number } | { ok: false; widest: number };

export function presetPaneWidth(
  page: number | 'fit',
  inset: number,
  range: PaneRange,
  zoom = 1,
): PresetFit {
  if (page === 'fit') return { ok: true, width: range.max };
  const width = paneWidthFor(page, inset, zoom);
  if (width > range.max) return { ok: false, widest: pageWidth(range.max, inset, zoom) };
  return { ok: true, width: Math.max(range.min, width) };
}

export function presetNotice(page: number, widest: number): string {
  return `The window is too narrow for a ${page} px page. The widest it can be now is ${widest} px; hide the sidebar or widen the window.`;
}
