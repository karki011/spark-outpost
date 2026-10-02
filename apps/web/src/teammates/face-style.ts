import type {
  TeammateColor,
  TeammateFace,
  TeammateShape,
  TeammateState,
} from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';

const SHAPE_TRAIT: Record<TeammateShape, number> = {
  round: 0.11,
  organic: 0.35,
  boxy: 0.54,
  capsule: 0.65,
  nub: 0.745,
  cloud: 0.825,
  droplet: 0.8875,
  hexagon: 0.9325,
  sun: 0.965,
  triangle: 0.99,
};

const COLOR_HUE: Record<TeammateColor, number> = {
  ember: 24,
  gold: 48,
  moss: 112,
  teal: 172,
  sky: 205,
  violet: 262,
  plum: 318,
  rose: 348,
};

export const SHAPE_LABELS: Record<TeammateShape, string> = {
  round: 'Round',
  organic: 'Pebble',
  boxy: 'Boxy',
  capsule: 'Capsule',
  nub: 'Nub',
  cloud: 'Cloud',
  droplet: 'Droplet',
  hexagon: 'Hexagon',
  sun: 'Sun',
  triangle: 'Triangle',
};

export const COLOR_LABELS: Record<TeammateColor, string> = {
  ember: 'Ember',
  gold: 'Gold',
  moss: 'Moss',
  teal: 'Teal',
  sky: 'Sky',
  violet: 'Violet',
  plum: 'Plum',
  rose: 'Rose',
};

const STATE_EXPRESSIONS: Record<TeammateState, BlobExpression> = {
  idle: 'idle',
  working: 'thinking',
  needs_you: 'unsure',
  done: 'happy',
  failed: 'sad',
};

export interface FaceRender {
  seed: string;
  hue: number;
  tone: number;
  traits: { shape: number };
}

export function faceRender(face: TeammateFace): FaceRender {
  return {
    seed: `teammate:${face.shape}:${face.color}`,
    hue: COLOR_HUE[face.color],
    tone: 0.5,
    traits: { shape: SHAPE_TRAIT[face.shape] },
  };
}

export function stateExpression(state: TeammateState): BlobExpression {
  return STATE_EXPRESSIONS[state];
}
