import type { AgentPick } from '@spark-outpost/contracts';
import { retiringOn } from '../model-cards/cards.ts';
import { modelTier, tierLadder, type TierModel } from './tiers.ts';

const FLOOR_TIER = 1;

export const FLOOR_REASON = "Builders don't run on the fast tier";

const READER_FLOOR_REASON = "the harness doesn't use the fast tier";

export type FloorRole = 'builder' | 'reader';

export type BuilderAim = 'floor' | 'top';

export type FloorNote =
  | { kind: 'raised'; from: string; to: string; retiring?: string; tierUnknown?: boolean }
  | { kind: 'tier_unknown'; model: string }
  | { kind: 'no_stronger'; model: string; retiring?: string }
  | { kind: 'retiring'; model: string; on: string };

export interface FlooredPick {
  pick: AgentPick;
  note: FloorNote | null;
}

export interface FloorOptions {
  aim?: BuilderAim;
  now?: Date;
}

function labelOf(pick: Pick<AgentPick, 'model' | 'modelLabel'>): string {
  return pick.modelLabel ?? pick.model ?? 'the agent default';
}

function asModel(pick: AgentPick): TierModel {
  return { id: pick.model ?? '', label: pick.modelLabel ?? '' };
}

function withModel(pick: AgentPick, model: TierModel): AgentPick {
  return { ...pick, model: model.id, modelLabel: model.label };
}

function pickTier(pick: AgentPick): number | null {
  return pick.model === null ? null : modelTier(asModel(pick), pick.provider);
}

function pickRetiring(pick: AgentPick, now: Date = new Date()): string | null {
  return pick.model === null ? null : retiringOn(asModel(pick), pick.provider, now);
}

export function belowFloor(pick: AgentPick, now: Date = new Date()): boolean {
  const tier = pickTier(pick);
  return (tier !== null && tier < FLOOR_TIER) || pickRetiring(pick, now) !== null;
}

export function harnessModels<T extends TierModel>(
  models: readonly T[],
  provider: string,
  now: Date = new Date(),
): T[] {
  return models.filter((model) => retiringOn(model, provider, now) === null);
}

function eligible<T extends TierModel>(models: readonly T[], provider: string, now: Date): T[] {
  return tierLadder(harnessModels(models, provider, now), provider).filter(
    (model) => (modelTier(model, provider) ?? -1) >= FLOOR_TIER,
  );
}

export function floorModel<T extends TierModel>(
  models: readonly T[],
  provider: string,
  now: Date = new Date(),
): T | null {
  return eligible(models, provider, now)[0] ?? null;
}

function unknownTier<T extends TierModel>(models: readonly T[], provider: string): T[] {
  return models.filter((model) => modelTier(model, provider) === null);
}

function raised(
  pick: AgentPick,
  model: TierModel,
  retiring: string | null,
  tierUnknown = false,
): FlooredPick {
  const to = withModel(pick, model);
  const note: FloorNote = {
    kind: 'raised',
    from: labelOf(pick),
    to: labelOf(to),
    ...(retiring ? { retiring } : {}),
    ...(tierUnknown ? { tierUnknown } : {}),
  };
  return { pick: to, note };
}

export function floorPick<T extends TierModel>(
  pick: AgentPick,
  models: readonly T[],
  { aim = 'floor', now = new Date() }: FloorOptions = {},
): FlooredPick {
  const tier = pickTier(pick);
  const retiring = pickRetiring(pick, now);
  const known = eligible(models, pick.provider, now);
  if (aim === 'top') {
    const top = known.at(-1);
    if (top && (tier === null || retiring || tier < (modelTier(top, pick.provider) ?? 0))) {
      return { pick: withModel(pick, top), note: null };
    }
  }
  if (tier === null) {
    return pick.model === null
      ? { pick, note: null }
      : { pick, note: { kind: 'tier_unknown', model: labelOf(pick) } };
  }
  if (tier >= FLOOR_TIER && !retiring) return { pick, note: null };
  const why = tier >= FLOOR_TIER ? retiring : null;
  const stronger = known[0];
  if (stronger) return raised(pick, stronger, why);
  const unknown = unknownTier(models, pick.provider)[0];
  if (unknown) return raised(pick, unknown, why, true);
  const note: FloorNote = { kind: 'no_stronger', model: labelOf(pick) };
  return { pick, note: retiring ? { ...note, retiring } : note };
}

export function retiringNote(pick: AgentPick, now: Date = new Date()): FloorNote | null {
  const on = pickRetiring(pick, now);
  return on ? { kind: 'retiring', model: labelOf(pick), on } : null;
}

function raiseReason(note: { from: string; retiring?: string }, role: FloorRole): string {
  if (note.retiring) return `${note.from} retires on ${note.retiring}`;
  return role === 'builder' ? FLOOR_REASON : READER_FLOOR_REASON;
}

export function floorReason(pick: AgentPick, role: FloorRole, now: Date = new Date()): string {
  const tier = pickTier(pick);
  const retiring = tier !== null && tier >= FLOOR_TIER ? pickRetiring(pick, now) : null;
  return raiseReason({ from: labelOf(pick), ...(retiring ? { retiring } : {}) }, role);
}

export function floorText(note: FloorNote, role: FloorRole = 'builder'): string {
  switch (note.kind) {
    case 'raised': {
      const text = `raised to ${note.to}: ${raiseReason(note, role)}`;
      return note.tierUnknown ? `${text} · tier unknown for ${note.to}` : text;
    }
    case 'tier_unknown':
      return `tier unknown for ${note.model}`;
    case 'no_stronger': {
      const nothing = role === 'builder' ? 'no stronger model for Builders' : 'nothing stronger';
      const text = `kept ${note.model}: ${nothing}`;
      return note.retiring ? `${text} · retiring on ${note.retiring}` : text;
    }
    case 'retiring':
      return `${note.model} retiring on ${note.on}`;
  }
}
