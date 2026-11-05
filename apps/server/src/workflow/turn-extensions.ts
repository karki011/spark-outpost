import { claudeConfigDir } from '../agent-config/permission-rules.ts';
import { conversationProjectIds } from '../agent-config/store.ts';
import { loadUserPlugins, type UserPluginLaunch } from '../agent-config/user-plugins/launch.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import { loadUserMcp, type UserMcpLaunch } from '../mcp/launch.ts';
import type { Queryable } from '../persistence/db.ts';

export interface TurnExtensions {
  userMcp: UserMcpLaunch[];
  userPlugins: UserPluginLaunch[];
}

function runsClaude(provider: string): boolean {
  return Object.values(agentDefinitions).some(
    (definition) => definition.id === provider && definition.repoStyle === 'claude',
  );
}

export async function loadTurnExtensions(
  db: Queryable,
  input: {
    assistant?: boolean;
    provider: string;
    workspaceId: string;
    identity: { threadId: string };
  },
): Promise<TurnExtensions> {
  if (input.assistant) return { userMcp: [], userPlugins: [] };
  const conversationId = input.identity.threadId;
  const [userMcp, userPlugins] = await Promise.all([
    conversationProjectIds(db, conversationId)
      .then((projectIds) => loadUserMcp(db, conversationId, projectIds))
      .catch(() => []),
    runsClaude(input.provider)
      ? loadUserPlugins(db, input.workspaceId, claudeConfigDir(process.env)).catch(() => [])
      : [],
  ]);
  return { userMcp, userPlugins };
}
