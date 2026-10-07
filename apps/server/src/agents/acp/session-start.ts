import type { PathPolicy } from '../../projects/path-policy.ts';
import { projectPolicy, RootMissingError } from '../../projects/project-fs.ts';
import { excludeSparkDir } from '../../projects/worktrees.ts';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import type { ClaudeRepoOptions } from './repo-session.ts';

export async function openProject(
  definition: AgentDefinition,
  roots: readonly string[],
): Promise<PathPolicy> {
  try {
    const policy = await projectPolicy(roots);
    if (definition.repoStyle === 'claude') await keepPlansUntracked(policy);
    return policy;
  } catch (error) {
    const root = error instanceof RootMissingError ? error.root : roots.join(', ');
    throw new ProviderError(
      `${definition.name} can't open the project folder ${root}. Check that it still exists, or link the project again.`,
    );
  }
}

async function keepPlansUntracked(policy: PathPolicy): Promise<void> {
  const root = policy.roots[0]?.path;
  if (root) await excludeSparkDir(root).catch(() => undefined);
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
