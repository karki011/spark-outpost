import type { MemberRoute } from '../orchestration/routing.ts';
import { demotedFor, demotionText, type Demotion } from './demotion.ts';

export function demotedRates(list: readonly Demotion[], provider: string): Map<string, number> {
  return new Map(
    list.filter((entry) => entry.provider === provider).map((entry) => [entry.model, entry.rate]),
  );
}

function considered(route: MemberRoute, chatModel: string | null): Set<string> {
  const ids = new Set<string>();
  if (chatModel) ids.add(chatModel);
  for (const model of route.score?.ranked ?? []) ids.add(model.id);
  if (route.sessionChoice?.session.model) ids.add(route.sessionChoice.session.model);
  return ids;
}

export function demotionNote(
  route: MemberRoute,
  list: readonly Demotion[],
  chatModel: string | null,
): string | null {
  const { provider, model } = route.pick;
  const picked = demotedFor(list, provider, model);
  if (route.routedBy === 'pinned') {
    return picked ? `${demotionText(picked)}; pinned, so Spark kept it` : null;
  }
  if (picked) return `${demotionText(picked)}; no better model was available`;
  const skipped = list.find(
    (entry) => entry.provider === provider && considered(route, chatModel).has(entry.model),
  );
  return skipped ? `${demotionText(skipped)}, so Spark routed this work elsewhere` : null;
}

export function withDemotion(
  route: MemberRoute,
  list: readonly Demotion[],
  chatModel: string | null,
): MemberRoute {
  const note = demotionNote(route, list, chatModel);
  if (!note) return route;
  return { ...route, note: route.note ? `${route.note} · ${note}` : note };
}
