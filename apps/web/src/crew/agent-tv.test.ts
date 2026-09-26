import { describe, expect, it } from 'vitest';
import { parseSavedTv } from './agent-tv-store.ts';
import { crewAgents } from './crew-projection.ts';
import { member, orchestration } from './test-orchestration.ts';
import { tvCaption } from './tv-caption.ts';
import {
  bubbleBox,
  clampToViewport,
  handoffPath,
  stageLayout,
  STAGES,
  watchStage,
} from './tv-layout.ts';

describe('Agent TV stage layout', () => {
  it('puts Jev on the floor and a lone agent straight above him', () => {
    const layout = stageLayout(1, STAGES.s);
    expect(layout.jev).toEqual({ x: 150, y: 160 });
    expect(layout.seats).toEqual([{ x: 150, y: 160 - layout.radius, outX: 0, outY: -1 }]);
    expect(stageLayout(0, STAGES.s).seats).toEqual([]);
  });

  it('seats the crew in a symmetric arc above Jev', () => {
    const { jev, seats } = stageLayout(3, STAGES.m);
    expect(seats[1]!.x).toBe(jev.x);
    expect(seats[0]!.x + seats[2]!.x).toBe(jev.x * 2);
    expect(seats[0]!.y).toBe(seats[2]!.y);
    expect(seats.every((seat) => seat.y < jev.y)).toBe(true);
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
    expect(watch.jevSize).toBeGreaterThan(STAGES.l.jevSize);
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
    const jev = bubbleBox({ x: 150, y: 160 }, 50, STAGES.s, true, 120);
    expect(jev).toMatchObject({ left: 90, width: 120, arrow: 60, below: false, edge: 121 });
  });

  it('keeps a dragged panel inside the viewport', () => {
    const size = { width: 300, height: 320 };
    const viewport = { width: 1000, height: 700 };
    expect(clampToViewport({ x: -40, y: 900 }, size, viewport)).toEqual({ x: 8, y: 372 });
  });
});

describe('Agent TV saved settings', () => {
  it('restores position, size and mute, ignoring anything malformed', () => {
    const saved = JSON.stringify({ position: { x: 40, y: 60 }, size: 'l', muted: true });
    expect(parseSavedTv(saved)).toEqual({ position: { x: 40, y: 60 }, size: 'l', muted: true });
    expect(parseSavedTv('{"position":{"x":"a"},"size":"xl"}')).toEqual({
      position: null,
      size: 's',
      muted: false,
    });
    expect(parseSavedTv('not json')).toEqual({ position: null, size: 's', muted: false });
  });
});

describe('Agent TV caption', () => {
  it('names the active handoff', () => {
    const building = member({ status: 'running', toolCalls: 1, planStep: 'Write the test' });
    expect(tvCaption(crewAgents(orchestration({ crew: [building] })))).toEqual({
      lead: 'Jev → Builder',
      text: 'write the test',
    });
  });

  it('falls back to what Jev is doing', () => {
    const done = orchestration({ status: 'succeeded', phase: 'finished', crew: [member()] });
    expect(tvCaption(crewAgents(done))).toEqual({ lead: 'Jev', text: 'ready for you' });
  });
});
