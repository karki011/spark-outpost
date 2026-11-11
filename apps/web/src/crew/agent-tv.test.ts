import { describe, expect, it } from 'vitest';
import { parseSavedTv } from './agent-tv-store.ts';
import { chatAgent } from './chat-agent.ts';
import { run } from './test-run.ts';
import { tvCaption } from './tv-caption.ts';
import {
  bubbleBox,
  chatArea,
  clampInto,
  dockInto,
  stageRoom,
  handoffPath,
  stageLayout,
  STAGES,
  tvStage,
  watchStage,
  dockStage,
} from './tv-layout.ts';

describe('Agent TV stage layout', () => {
  it('puts the agent of the chat on the floor and a lone Spark straight above it', () => {
    const layout = stageLayout(1, STAGES.s);
    expect(layout.lead).toEqual({ x: 150, y: 160 });
    expect(layout.seats).toEqual([{ x: 150, y: 160 - layout.radius, outX: 0, outY: -1 }]);
    expect(stageLayout(0, STAGES.s).seats).toEqual([]);
  });

  it('seats the Sparks in a symmetric arc above the agent of the chat', () => {
    const { lead, seats } = stageLayout(3, STAGES.m);
    expect(seats[1]!.x).toBe(lead.x);
    expect(seats[0]!.x + seats[2]!.x).toBe(lead.x * 2);
    expect(seats[0]!.y).toBe(seats[2]!.y);
    expect(seats.every((seat) => seat.y < lead.y)).toBe(true);
  });

  it('keeps every seat and label on stage for a large crew in every size', () => {
    const stages = [STAGES.s, STAGES.m, STAGES.l, watchStage({ width: 1440, height: 900 })];
    for (const stage of stages) {
      for (let count = 1; count <= 8; count += 1) {
        for (const seat of stageLayout(count, stage).seats) {
          expect(seat.x - stage.labelWidth / 2).toBeGreaterThanOrEqual(0);
          expect(seat.x + stage.labelWidth / 2).toBeLessThanOrEqual(stage.width);
          expect(seat.y - stage.crewSize / 2).toBeGreaterThanOrEqual(0);
          expect(seat.y + stage.crewSize / 2 + 40).toBeLessThanOrEqual(stage.height);
        }
      }
    }
  });

  it('spaces neighbours so their labels do not collide while there is room', () => {
    const { seats } = stageLayout(4, STAGES.s);
    for (let index = 1; index < seats.length; index += 1) {
      const gap = Math.hypot(
        seats[index]!.x - seats[index - 1]!.x,
        seats[index]!.y - seats[index - 1]!.y,
      );
      expect(gap).toBeGreaterThanOrEqual(STAGES.s.labelWidth - 1);
    }
  });

  it('grows the stage and the blobs in watch mode, within limits', () => {
    const watch = watchStage({ width: 1440, height: 900 });
    expect(watch.width).toBe(1100);
    expect(watch.height).toBe(680);
    expect(watch.leadSize).toBeGreaterThan(STAGES.l.leadSize);
    expect(watch.crewSize).toBeGreaterThan(STAGES.l.crewSize);
    expect(watchStage({ width: 360, height: 500 }).width).toBe(320);
  });

  it('bends the handoff path to one side of the straight line', () => {
    expect(handoffPath({ x: 0, y: 100 }, { x: 100, y: 100 })).toBe('M0 100 Q50 122 100 100');
    expect(handoffPath({ x: 100, y: 100 }, { x: 0, y: 100 })).toBe('M100 100 Q50 78 0 100');
  });

  it('keeps speech bubbles inside the stage and points the tail at the speaker', () => {
    const edge = bubbleBox({ x: 20, y: 40 }, 34, STAGES.s);
    expect(edge).toMatchObject({ left: 8, width: 240, arrow: 12, below: true });
    const centre = bubbleBox({ x: 150, y: 160 }, 50, STAGES.s, true, 120);
    expect(centre).toMatchObject({
      left: 90,
      width: 120,
      arrow: 60,
      below: false,
      edge: 121,
      room: 121,
    });
  });

  it('keeps a dragged panel inside the chat area', () => {
    const size = { width: 300, height: 320 };
    const area = { left: 100, top: 50, right: 1000, bottom: 700 };
    expect(clampInto({ x: -40, y: 900 }, size, area)).toEqual({ x: 108, y: 372 });
    expect(clampInto({ x: 900, y: 0 }, size, area)).toEqual({ x: 692, y: 58 });
  });

  it('docks inside the chat column, left of a side pane', () => {
    const column = { left: 300, top: 60, right: 1400, bottom: 860 };
    const pane = { left: 1000, top: 0, right: 1680, bottom: 1000 };
    const area = chatArea(column, pane);
    expect(area.right).toBe(1000);
    expect(chatArea(column, { ...pane, left: 1500, right: 1600 })).toBe(column);
    expect(dockInto(area, { width: 1680, height: 1000 })).toEqual({
      right: 696,
      bottom: 156,
      maxWidth: 668,
      maxHeight: 768,
    });
  });

  it('picks the largest stage that fits and shortens it for a lone agent', () => {
    const roomy = { width: 1000, height: 800 };
    expect(tvStage('l', null, 2)).toBe(STAGES.l);
    expect(tvStage('l', { width: 400, height: 800 }, 2)).toBe(STAGES.m);
    expect(tvStage('l', { width: 360, height: 800 }, 2)).toBe(STAGES.s);
    expect(tvStage('m', roomy, 0)).toMatchObject({ width: 380, height: 234 });
    expect(tvStage('s', { width: 240, height: 800 }, 1).width).toBe(240);
  });

  it('keeps the fallback stage within a room smaller than its preferred minimum', () => {
    const room = { width: 160, height: 100 };
    for (const crew of [0, 3]) {
      const stage = tvStage('l', room, crew);
      expect(stage.width).toBeLessThanOrEqual(room.width);
      expect(stage.height).toBeLessThanOrEqual(room.height);
      expect(stage.width).toBeGreaterThan(0);
      expect(stage.height).toBeGreaterThan(0);
    }
  });

  it('picks a stage that fits a short window under the header, caption and sub-agents', () => {
    const dock = dockInto(
      { left: 300, top: 60, right: 1300, bottom: 480 },
      { width: 1400, height: 600 },
    );
    const room = stageRoom(dock, true);
    expect(room.height).toBe(388 - 76 - 90);
    const messagingRoom = stageRoom(dock, true, true);
    expect(messagingRoom.height).toBeLessThanOrEqual(room.height - 100);
    expect(tvStage('l', messagingRoom, 3).height).toBeLessThanOrEqual(messagingRoom.height);
    const short = tvStage('l', room, 3);
    expect(short.height).toBeLessThanOrEqual(room.height);
    expect(short.width).toBeLessThanOrEqual(room.width);
    expect(tvStage('l', { width: 1000, height: 300 }, 3)).toBe(STAGES.m);
  });
});

describe('Agent TV saved settings', () => {
  it('restores position, size, mute and view, ignoring anything malformed', () => {
    const saved = JSON.stringify({
      position: { x: 40, y: 60 },
      size: 'l',
      muted: true,
      view: 'list',
    });
    expect(parseSavedTv(saved)).toEqual({
      position: { x: 40, y: 60 },
      size: 'l',
      muted: true,
      view: 'list',
    });
    expect(parseSavedTv('{"position":{"x":"a"},"size":"xl","view":"grid"}')).toEqual({
      position: null,
      size: 's',
      muted: false,
      view: 'stage',
    });
    expect(parseSavedTv('not json')).toEqual({
      position: null,
      size: 's',
      muted: false,
      view: 'stage',
    });
  });
});

describe('Agent TV caption', () => {
  it('names the agent that is working and what it is doing', () => {
    const working = chatAgent(run({ status: 'running' }), [
      { name: 'Edit notes.txt', done: false },
    ]);
    expect(tvCaption([working])).toEqual({ lead: 'Claude', text: 'edit notes.txt' });
  });

  it('falls back to how the chat’s agent ended', () => {
    expect(tvCaption([chatAgent(run({ status: 'succeeded' }))])).toEqual({
      lead: 'Claude',
      text: 'done',
    });
    expect(tvCaption([])).toEqual({ lead: null, text: 'No agents yet' });
  });
});

describe('dockStage', () => {
  it('keeps the base size when the rail is narrow or not measured yet', () => {
    expect(dockStage(0)).toEqual(dockStage(200));
    expect(dockStage(200)).toMatchObject({ width: 200, height: 128, leadSize: 34, fontSize: 12 });
  });

  it('grows every part with the rail and stops at the cap', () => {
    const wide = dockStage(300);
    expect(wide).toEqual({
      width: 300,
      height: 192,
      leadSize: 51,
      crewSize: 39,
      labelWidth: 93,
      fontSize: 13,
    });
    expect(dockStage(900)).toEqual(dockStage(320));
  });

  it('keeps a small team in the existing arc', () => {
    expect(dockStage(300, 3)).toEqual(dockStage(300));
  });

  it('gives every worker a readable, non-overlapping row seat in a crowded rail', () => {
    for (const width of [200, 260, 300, 320]) {
      for (const count of [4, 5, 8, 12, 20]) {
        const stage = dockStage(width, count);
        const { lead, seats } = stageLayout(count, stage);
        expect(seats).toHaveLength(count);
        expect(stage.fontSize).toBeGreaterThanOrEqual(12);
        for (const [index, seat] of seats.entries()) {
          expect(seat.x - stage.labelWidth / 2).toBeGreaterThanOrEqual(0);
          expect(seat.x + stage.labelWidth / 2).toBeLessThanOrEqual(stage.width);
          expect(seat.y - stage.crewSize / 2).toBeGreaterThanOrEqual(0);
          expect(seat.y + stage.crewSize / 2 + 20).toBeLessThan(lead.y - stage.leadSize / 2);
          for (const other of seats.slice(index + 1)) {
            const separateColumns = Math.abs(other.x - seat.x) >= stage.labelWidth;
            const separateRows = Math.abs(other.y - seat.y) >= stage.crewSize + 20;
            expect(separateColumns || separateRows).toBe(true);
          }
        }
        expect(lead.y + stage.leadSize / 2 + 20).toBeLessThanOrEqual(stage.height);
      }
    }
  });
});
