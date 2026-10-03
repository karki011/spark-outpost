import type { PathPolicy } from '../../projects/path-policy.ts';
import { projectPolicy, RootMissingError } from '../../projects/project-fs.ts';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import type { ClaudeRepoOptions } from './repo-session.ts';

export async function openProject(
  definition: AgentDefinition,
  roots: readonly string[],
): Promise<PathPolicy> {
  try {
    return await projectPolicy(roots);
  } catch (error) {
    const root = error instanceof RootMissingError ? error.root : roots.join(', ');
    throw new ProviderError(
      `${definition.name} can't open the project folder ${root}. Check that it still exists, or link the project again.`,
    );
  }
}

export function extraRoots(policy: PathPolicy | null): string[] {
  return policy ? policy.roots.slice(1).map((root) => root.path) : [];
}

export function sessionMeta(
  definition: AgentDefinition,
  policy: PathPolicy | null,
  changing: boolean,
  repo: ClaudeRepoOptions | null,
  {
    builder,
    coordinated,
    publishes,
    planning,
    approvals,
  }: Pick<ProviderTurn, 'builder' | 'coordinated' | 'publishes' | 'planning' | 'approvals'>,
) {
  if (!policy) return definition.conversationSessionMeta?.(repo) ?? null;
  const roots = extraRoots(policy);
  if (changing) {
    return definition.doSessionMeta?.(roots, repo, builder, coordinated, publishes) ?? null;
  }
  const commands = approvals !== undefined;
  return definition.projectSessionMeta?.(roots, repo, planning === true, commands) ?? null;
}
