import { gitControlGlobs, readGitDirs } from '../../approvals/git-dirs.ts';
import type { PathPolicy, ProjectRoot } from '../../projects/path-policy.ts';
import { projectPolicy, RootMissingError } from '../../projects/project-fs.ts';
import { excludeSparkDir } from '../../projects/worktrees.ts';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { CLAUDE_WAIT_TOOLS } from './claude-tools.ts';
import type { ClaudeRepoOptions } from './repo-session.ts';

export async function openProject(
  definition: AgentDefinition,
  roots: readonly string[],
): Promise<PathPolicy> {
  try {
    const opened = await projectPolicy(roots);
    const policy = { ...opened, roots: await Promise.all(opened.roots.map(withGitDirs)) };
    if (definition.repoStyle === 'claude') await keepPlansUntracked(policy);
    return policy;
  } catch (error) {
    const root = error instanceof RootMissingError ? error.root : roots.join(', ');
    throw new ProviderError(
      `${definition.name} can't open the project folder ${root}. Check that it still exists, or link the project again.`,
    );
  }
}

async function withGitDirs(root: ProjectRoot): Promise<ProjectRoot> {
  return { ...root, gitDirs: await readGitDirs(root.path) };
}

async function keepPlansUntracked(policy: PathPolicy): Promise<void> {
  const root = policy.roots[0]?.path;
  if (root) await excludeSparkDir(root).catch(() => undefined);
}

export function extraRoots(policy: PathPolicy | null): string[] {
  return policy ? policy.roots.slice(1).map((root) => root.path) : [];
}

const THINKING_ARGS = { 'thinking-display': 'summarized' };

interface ClaudeOptions {
  tools?: string[];
  disallowedTools?: string[];
  settings?: { permissions?: { deny?: string[] } };
}

function withoutWaiting(meta: Record<string, unknown>): Record<string, unknown> {
  const claudeCode = meta.claudeCode as { options?: ClaudeOptions } | undefined;
  const options = claudeCode?.options;
  if (!options?.tools) return meta;
  const waits = (tool: string) => (CLAUDE_WAIT_TOOLS as readonly string[]).includes(tool);
  const permissions = options.settings?.permissions ?? {};
  const kept = {
    ...options,
    tools: options.tools.filter((tool) => !waits(tool)),
    disallowedTools: [...(options.disallowedTools ?? []), ...CLAUDE_WAIT_TOOLS],
    settings: {
      ...options.settings,
      permissions: { ...permissions, deny: [...(permissions.deny ?? []), ...CLAUDE_WAIT_TOOLS] },
    },
  };
  return { ...meta, claudeCode: { ...claudeCode, options: kept } };
}

function withThinkingShown(meta: Record<string, unknown>): Record<string, unknown> {
  const claudeCode = meta.claudeCode as { options: Record<string, unknown> };
  const options = { ...claudeCode.options, extraArgs: THINKING_ARGS };
  return { ...meta, claudeCode: { ...claudeCode, options } };
}

function definedMeta(
  definition: AgentDefinition,
  policy: PathPolicy | null,
  changing: boolean,
  repo: ClaudeRepoOptions | null,
  {
    changesProject,
    planning,
    approvals,
  }: Pick<ProviderTurn, 'changesProject' | 'planning' | 'approvals' | 'sparkScope'>,
) {
  if (!policy) return definition.conversationSessionMeta?.(repo) ?? null;
  const roots = extraRoots(policy);
  if (changing) {
    const gitControl = gitControlGlobs(policy.roots);
    return definition.doSessionMeta?.(roots, repo, changesProject, gitControl) ?? null;
  }
  const commands = approvals !== undefined;
  return definition.projectSessionMeta?.(roots, repo, planning === true, commands) ?? null;
}

export function sessionMeta(...args: Parameters<typeof definedMeta>) {
  const defined = definedMeta(...args);
  const meta = defined && args[4].sparkScope?.assistant ? withoutWaiting(defined) : defined;
  return meta && args[0].summarizesThinking ? withThinkingShown(meta) : meta;
}
