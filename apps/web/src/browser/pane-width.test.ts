import { describe, expect, it } from 'vitest';
import {
  CHAT_MIN_WIDTH,
  PAGE_MIN_WIDTH,
  OVERLAY_OPEN_WIDTH,
  dockedRoom,
  openingPaneWidth,
  overlayRoom,
  pageWidth,
  paneRange,
  presetNotice,
  presetPaneWidth,
  shownPaneWidth,
} from './pane-width.ts';

const INSET = 18;

describe('pane room', () => {
  it('leaves the chat its minimum width beside a docked pane', () => {
    expect(dockedRoom({ rowRight: 1432, chatLeft: 76, gaps: 8 })).toBe(
      1432 - 76 - 8 - CHAT_MIN_WIDTH,
    );
  });

  it('gives the pane less room while the sidebar is open', () => {
    const collapsed = dockedRoom({ rowRight: 1432, chatLeft: 76, gaps: 8 });
    const open = dockedRoom({ rowRight: 1432, chatLeft: 376, gaps: 8 });
    expect(collapsed - open).toBe(300);
  });

  it('opens an overlay pane narrower than a docked one until a width is saved', () => {
    expect(openingPaneWidth(640, false)).toBe(640);
    expect(openingPaneWidth(640, true)).toBe(OVERLAY_OPEN_WIDTH);
    expect(openingPaneWidth(360, true)).toBe(360);
  });

  it('lets an overlay pane cover the window less its edges', () => {
    expect(overlayRoom(1000, 16)).toBe(984);
  });
});

describe('pane range', () => {
  it('starts at a 320 px page and ends at the room', () => {
    expect(paneRange(900, INSET)).toEqual({ min: PAGE_MIN_WIDTH + INSET, max: 900 });
  });

  it('never ends below its start in a cramped window', () => {
    expect(paneRange(200, INSET)).toEqual({ min: 338, max: 338 });
  });

  it('shows a saved width only as wide as the window allows', () => {
    const range = paneRange(700, INSET);
    expect(shownPaneWidth(1200, range)).toBe(700);
    expect(shownPaneWidth(100, range)).toBe(338);
    expect(shownPaneWidth(512.4, range)).toBe(512);
  });
});

describe('page width presets', () => {
  const range = paneRange(1100, INSET);

  it('sizes the pane so the page gets the preset width', () => {
    expect(presetPaneWidth(390, INSET, range)).toEqual({ ok: true, width: 408 });
    expect(presetPaneWidth(320, INSET, range)).toEqual({ ok: true, width: 338 });
  });

  it('fits the widest pane the window allows', () => {
    expect(presetPaneWidth('fit', INSET, range)).toEqual({ ok: true, width: 1100 });
  });

  it('refuses a preset wider than the window instead of clamping it', () => {
    expect(presetPaneWidth(1280, INSET, range)).toEqual({ ok: false, widest: 1082 });
    expect(presetNotice(1280, 1082)).toBe(
      'The window is too narrow for a 1280 px page. The widest it can be now is 1082 px; hide the sidebar or widen the window.',
    );
  });

  it('accepts a preset that exactly fills the room', () => {
    expect(presetPaneWidth(1082, INSET, range)).toEqual({ ok: true, width: 1100 });
  });
});

describe('page widths under app zoom', () => {
  const zoom = 1.25;
  const range = paneRange(1100, INSET, zoom);

  it('reads the page width the shell gives the page, not the pane in app pixels', () => {
    expect(pageWidth(330, INSET, zoom)).toBe(390);
    expect(pageWidth(330, INSET, 1)).toBe(312);
  });

  it('keeps the smallest pane a 320 px page', () => {
    expect(range.min).toBe(256 + INSET);
    expect(pageWidth(range.min, INSET, zoom)).toBe(PAGE_MIN_WIDTH);
  });

  it('sizes a preset so the page gets that width at the zoom', () => {
    expect(presetPaneWidth(390, INSET, range, zoom)).toEqual({ ok: true, width: 330 });
    expect(presetPaneWidth(1280, INSET, range, zoom)).toEqual({ ok: true, width: 1042 });
    expect(presetPaneWidth(1280, INSET, paneRange(1000, INSET, zoom), zoom)).toEqual({
      ok: false,
      widest: 1228,
    });
  });
});
