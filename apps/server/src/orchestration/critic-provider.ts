import type { RouteContext } from './routing.ts';

export interface BuiltShare {
  provider: string;
  files: number;
}

function smallestShare(context: RouteContext, built: readonly BuiltShare[]): string {
  const share = (provider: string) =>
    built
      .filter((entry) => entry.provider === provider)
      .reduce((sum, entry) => sum + entry.files, 0);
  const ranked = context.candidates
    .map((candidate) => candidate.provider)
    .sort(
      (a, b) =>
        share(a) - share(b) ||
        Number(a === context.chat.provider) - Number(b === context.chat.provider),
    );
  return ranked[0] ?? context.chat.provider;
}

export function criticProvider(context: RouteContext, built: readonly BuiltShare[] = []): string {
  const builders = new Set([context.chat.provider, ...built.map((entry) => entry.provider)]);
  const fresh = context.candidates.find((candidate) => !builders.has(candidate.provider));
  if (fresh) return fresh.provider;
  if (context.candidates.length < 2) return context.chat.provider;
  return smallestShare(context, built);
}
