import type { AgentPick } from '@spark-outpost/contracts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { nearestUsable } from '../model-access/nearest.ts';
import type { MemberRoute, RouteContext } from './routing.ts';

export function accessNote(context: RouteContext, pick: AgentPick): string | null {
  const leftOut = context.leftOut?.[pick.provider] ?? [];
  const candidate = context.candidates.find((entry) => entry.provider === pick.provider);
  if (leftOut.length === 0 || !candidate || pick.model === null) return null;
  const models = selectableModels(candidate);
  const replaced = leftOut.filter(
    (model) => nearestUsable(model, models, pick.provider, context.now)?.id === pick.model,
  );
  if (replaced.length === 0) return null;
  const names = replaced.map((model) => model.label).join(', ');
  return `${names} not usable with this sign-in → ${pick.modelLabel ?? pick.model}`;
}

export function withAccessNote(context: RouteContext, route: MemberRoute): MemberRoute {
  const note = accessNote(context, route.pick);
  if (!note || route.note?.includes(note)) return route;
  return { ...route, note: route.note ? `${route.note} · ${note}` : note };
}
