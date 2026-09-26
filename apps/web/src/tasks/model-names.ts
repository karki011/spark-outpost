import { useQueries } from '@tanstack/react-query';
import { providerIdSchema, type CapabilityOption } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { AGENT_DEFAULT, shortLabel } from '../chat/composer/model-options.ts';

const HOUR = 60 * 60 * 1000;
const CLAUDE_ID = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+))?(?:-(\d+))?/i;

export type ModelNamer = (provider: string, model: string | null) => string;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function prettyModelId(model: string): string {
  const bare = model.replace(/\[[^\]]*\]$/, '');
  const claude = CLAUDE_ID.exec(bare);
  if (claude) {
    const version = [claude[2], claude[3]].filter(Boolean).join('.');
    return version ? `${capitalize(claude[1]!)} ${version}` : capitalize(claude[1]!);
  }
  return bare;
}

export function modelName(
  options: readonly Pick<CapabilityOption, 'id' | 'label'>[],
  model: string | null,
): string {
  if (!model || model === AGENT_DEFAULT) return 'Default model';
  const option = options.find((candidate) => candidate.id === model);
  return option ? shortLabel(option.label) : prettyModelId(model);
}

export function useModelNamer(providers: readonly string[]): ModelNamer {
  const known = [...new Set(providers)].flatMap((provider) => {
    const parsed = providerIdSchema.safeParse(provider);
    return parsed.success ? [parsed.data] : [];
  });
  const queries = useQueries({
    queries: known.map((provider) => ({
      queryKey: queryKeys.capabilities(provider),
      queryFn: () => api.getCapabilities(provider),
      staleTime: HOUR,
    })),
  });
  const options = new Map<string, readonly CapabilityOption[]>(
    known.map((provider, index) => [provider, queries[index]?.data?.models ?? []]),
  );
  return (provider, model) => modelName(options.get(provider) ?? [], model);
}
