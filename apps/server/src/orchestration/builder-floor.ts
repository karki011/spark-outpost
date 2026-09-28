import type { AgentPick } from '@spark-outpost/contracts';
import { modelTier, tierLadder, type TierModel } from './tiers.ts';

export const BUILDER_FLOOR_TIER = 1;

export const FLOOR_REASON = "Builders don't run on the fast tier";

export type BuilderAim = 'floor' | 'top';

export type FloorNote =
  | { kind: 'raised'; from: string; to: string; tierUnknown?: boolean }
  | { kind: 'tier_unknown'; model: string }
  | { kind: 'no_stronger'; model: string };

export interface FlooredPick {
  pick: AgentPick;
  note: FloorNote | null;
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

export function pickTier(pick: AgentPick): number | null {
  return pick.model === null ? null : modelTier(asModel(pick), pick.provider);
}

export function belowFloor(pick: AgentPick): boolean {
  const tier = pickTier(pick);
  return tier !== null && tier < BUILDER_FLOOR_TIER;
}

function eligible<T extends TierModel>(models: readonly T[], provider: string): T[] {
  return tierLadder(models, provider).filter(
    (model) => (modelTier(model, provider) ?? -1) >= BUILDER_FLOOR_TIER,
  );
}

function unknownTier<T extends TierModel>(models: readonly T[], provider: string): T[] {
  return models.filter((model) => modelTier(model, provider) === null);
}

function raised(pick: AgentPick, model: TierModel, tierUnknown = false): FlooredPick {
  const to = withModel(pick, model);
  const note: FloorNote = { kind: 'raised', from: labelOf(pick), to: labelOf(to) };
  return { pick: to, note: tierUnknown ? { ...note, tierUnknown } : note };
}

export function builderPick<T extends TierModel>(
  pick: AgentPick,
  models: readonly T[],
  aim: BuilderAim = 'floor',
): FlooredPick {
  const tier = pickTier(pick);
  const known = eligible(models, pick.provider);
  if (aim === 'top') {
    const top = known.at(-1);
    if (top && (tier === null || tier < (modelTier(top, pick.provider) ?? 0))) {
      return { pick: withModel(pick, top), note: null };
    }
  }
  if (tier === null) {
    return pick.model === null
      ? { pick, note: null }
      : { pick, note: { kind: 'tier_unknown', model: labelOf(pick) } };
  }
  if (tier >= BUILDER_FLOOR_TIER) return { pick, note: null };
  const stronger = known[0];
  if (stronger) return raised(pick, stronger);
  const unknown = unknownTier(models, pick.provider)[0];
  if (unknown) return raised(pick, unknown, true);
  return { pick, note: { kind: 'no_stronger', model: labelOf(pick) } };
}

export function floorText(note: FloorNote): string {
  switch (note.kind) {
    case 'raised': {
      const text = `raised to ${note.to}: ${FLOOR_REASON}`;
      return note.tierUnknown ? `${text} · tier unknown for ${note.to}` : text;
    }
    case 'tier_unknown':
      return `tier unknown for ${note.model}`;
    case 'no_stronger':
      return `kept ${note.model}: no stronger model for Builders`;
  }
}
