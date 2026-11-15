import { describe, expect, it } from 'vitest';
import {
  DOCK_ABOVE,
  FLOAT_BELOW,
  SPLIT_FLOAT_BELOW,
  dockedSideWidth,
  floatsSidebar,
} from './sidebar-room.ts';

const base = { sideWidth: 300, docked: true, floating: false };
const floating = { ...base, docked: false, floating: true };

describe('floatsSidebar', () => {
  it('keeps the sidebar docked while the chat has room', () => {
    expect(floatsSidebar({ ...base, rooms: [900] })).toBe(false);
    expect(floatsSidebar({ ...base, rooms: [FLOAT_BELOW] })).toBe(false);
  });

  it('floats it once the docked sidebar squeezes the chat', () => {
    expect(floatsSidebar({ ...base, rooms: [FLOAT_BELOW - 1] })).toBe(true);
  });

  it('judges the narrowest of two chats side by side, against a lower bar', () => {
    expect(floatsSidebar({ ...base, rooms: [800, 380] })).toBe(false);
    expect(floatsSidebar({ ...base, rooms: [800, SPLIT_FLOAT_BELOW - 1] })).toBe(true);
  });

  it('counts the room the sidebar would take back when it is not docked', () => {
    expect(floatsSidebar({ ...floating, rooms: [760] })).toBe(true);
    expect(floatsSidebar({ ...base, docked: false, rooms: [650] })).toBe(true);
    expect(floatsSidebar({ ...base, docked: false, rooms: [800] })).toBe(false);
  });

  it('waits for clear room before docking again, so it never flickers at the edge', () => {
    expect(floatsSidebar({ ...floating, rooms: [300 + FLOAT_BELOW + 20] })).toBe(true);
    expect(floatsSidebar({ ...floating, rooms: [300 + DOCK_ABOVE] })).toBe(false);
  });

  it('keeps its choice while no chat is on screen', () => {
    expect(floatsSidebar({ ...base, rooms: [], floating: true })).toBe(true);
    expect(floatsSidebar({ ...base, rooms: [] })).toBe(false);
  });
});

describe('dockedSideWidth', () => {
  it('uses the saved width, capped at 36% of the window', () => {
    expect(dockedSideWidth(360, 300, 1600)).toBe(360);
    expect(dockedSideWidth(null, 300, 1600)).toBe(300);
    expect(dockedSideWidth(400, 300, 1000)).toBe(360);
  });
});
