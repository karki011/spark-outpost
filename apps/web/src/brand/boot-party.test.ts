import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { blobatar } from 'blobatar';
import * as expressions from 'blobatar/expression';
import { describe, expect, it } from 'vitest';
import type { TeammateColor, TeammateShape } from '@spark-outpost/contracts';
import { BOOT_STATUS } from '../../../desktop/src/boot-steps.ts';
import { faceRender } from '../teammates/face-style.ts';

interface Face {
  shape: TeammateShape;
  color: TeammateColor;
  fill: string;
  ink: string;
  body: string;
  idle: string;
  happy: string;
  sleepy: string;
}

interface Slot {
  face: Face;
  x: number;
  role: 'dancer' | 'sleeper' | 'juggler';
  delay: number;
}

interface Party {
  slots: Slot[];
  peeker: Face;
  herald: Face;
}

interface Routine {
  name: string;
  members: number[];
  side?: string;
  wait: number;
}

interface Teaser {
  label: string;
  text: string;
}

interface Plan {
  FINAL_STATUS: string;
  cast(faces: Face[], random: () => number): Party;
  nextRoutine(party: Party, random: () => number, last: string | null): Routine;
  stepReaction(party: Party, random: () => number): { highFive: number[]; cheer: number[] };
  teaserTimeline(count: number): { arrive: number; reveal: number; leave: number; gone: number }[];
  cleanTeasers(raw: unknown): Teaser[];
  spoken(teasers: Teaser[]): string;
}

function loadPublic<T>(file: string, name: string): T {
  const window: Record<string, unknown> = {};
  const source = readFileSync(path.join(import.meta.dirname, '../../public', file), 'utf8');
  runInNewContext(source, { window });
  return window[name] as T;
}

const faces = loadPublic<Face[]>('boot-faces.js', 'BOOT_FACES');
const plan = loadPublic<Plan>('boot-party-plan.js', 'BootPartyPlan');

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function parts(svg: string) {
  const match = svg.match(/<g fill="(#[0-9a-f]+)">(.*?)<\/g><g fill="(#[0-9a-f]+)">(.*?)<\/g>/);
  return { fill: match?.[1], body: match?.[2], ink: match?.[3], eyes: match?.[4] };
}

describe('boot party faces', () => {
  it('are the Sparks faces the app draws, with idle, happy and sleepy eyes', () => {
    expect(faces).toHaveLength(8);
    for (const face of faces) {
      const render = faceRender({ shape: face.shape, color: face.color });
      const options = { hue: render.hue, tone: render.tone, traits: render.traits };
      const idle = parts(blobatar(render.seed, options));
      expect({ fill: face.fill, body: face.body, ink: face.ink, eyes: face.idle }).toEqual(idle);
      expect(face.happy).toBe(
        parts(blobatar(render.seed, { ...options, expression: expressions.happy })).eyes,
      );
      expect(face.sleepy).toBe(
        parts(blobatar(render.seed, { ...options, expression: expressions.sleepy })).eyes,
      );
    }
  });
});

describe('boot party plan', () => {
  it('casts every face once, with a sleeper and a juggler on the outer edges', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const party = plan.cast(faces, seeded(seed));
      const used = [...party.slots.map((slot) => slot.face), party.peeker, party.herald];
      expect(new Set(used).size).toBe(faces.length);
      const outer = [party.slots[0]?.role, party.slots.at(-1)?.role].sort();
      expect(outer).toEqual(['juggler', 'sleeper']);
      expect(party.slots.slice(1, -1).every((slot) => slot.role === 'dancer')).toBe(true);
      expect(party.slots.every((slot) => slot.delay >= 450 && slot.delay <= 1300)).toBe(true);
    }
  });

  it('varies the cast between launches', () => {
    const lineups = new Set(
      [1, 2, 3, 4, 5].map((seed) =>
        plan
          .cast(faces, seeded(seed))
          .slots.map((slot) => slot.face.shape)
          .join(),
      ),
    );
    expect(lineups.size).toBeGreaterThan(1);
  });

  it('never repeats a routine back to back and only moves dancers', () => {
    const random = seeded(7);
    const party = plan.cast(faces, random);
    let last: string | null = null;
    const names = new Set<string>();
    for (let turn = 0; turn < 200; turn += 1) {
      const routine = plan.nextRoutine(party, random, last);
      expect(routine.name).not.toBe(last);
      expect(routine.wait).toBeGreaterThanOrEqual(1800);
      for (const member of routine.members) expect(party.slots[member]?.role).toBe('dancer');
      if (routine.name === 'bump')
        expect(Math.abs(routine.members[0]! - routine.members[1]!)).toBe(1);
      if (routine.name === 'peek') expect(['left', 'right']).toContain(routine.side);
      names.add(routine.name);
      last = routine.name;
    }
    expect([...names].sort()).toEqual(['bump', 'conga', 'hop', 'peek']);
  });

  it('cheers every step change with a high five between neighbours', () => {
    const random = seeded(3);
    const party = plan.cast(faces, random);
    const reaction = plan.stepReaction(party, random);
    const [left, right] = reaction.highFive;
    expect(right! - left!).toBe(1);
    expect(party.slots[left!]!.x).toBeLessThan(party.slots[right!]!.x);
    expect([...reaction.highFive, ...reaction.cheer].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('knows the final startup step', () => {
    expect(plan.FINAL_STATUS).toBe(BOOT_STATUS.spark);
  });
});

describe('boot teasers', () => {
  it('shows one teaser at a time', () => {
    const timeline = plan.teaserTimeline(3);
    timeline.forEach((step, index) => {
      expect(step.arrive).toBeLessThan(step.reveal);
      expect(step.reveal).toBeLessThan(step.leave);
      expect(step.leave).toBeLessThan(step.gone);
      const next = timeline[index + 1];
      if (next) expect(step.gone).toBeLessThan(next.arrive);
    });
  });

  it('keeps only well-formed teasers and speaks them once without emoji', () => {
    const teasers = plan.cleanTeasers([
      { label: 'While you were away', text: 'Wren is waiting on you 👀' },
      { label: 'Tip', text: '' },
      { label: 3, text: 'bad' },
      null,
      { label: 'Tip', text: 'Answer Spark Island cards with Y and N' },
      { label: 'Tip', text: 'x'.repeat(300) },
    ]);
    expect(teasers).toHaveLength(3);
    expect(teasers[2]?.text).toHaveLength(120);
    expect(plan.cleanTeasers('nope')).toEqual([]);
    expect(plan.spoken(teasers.slice(0, 2))).toBe(
      'While you were away: Wren is waiting on you. Tip: Answer Spark Island cards with Y and N.',
    );
  });
});
