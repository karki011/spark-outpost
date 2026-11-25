const STARTING_MODEL = 'ANTHROPIC_MODEL';

export function withStartingModel(
  definition: { id: string },
  env: Record<string, string>,
  model: string | null | undefined,
): Record<string, string> {
  if (definition.id !== 'claude' || !model) return env;
  return { ...env, [STARTING_MODEL]: model };
}
