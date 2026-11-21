import { stat } from 'node:fs/promises';
import type { ProviderId } from '@spark-outpost/contracts';
import { getCapabilities, resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { listProjects } from '../projects/projects.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { reportedEfforts } from '../providers/efforts.ts';
import { providerModePosture } from './chat-posture.ts';
import type { PlanAgent, PlanFacts } from './plan.ts';
import { modeChoices } from './proposed-mode.ts';

const PARENT_HAS_NO_AGENT = 'This chat has no connected agent to start sub-chats with.';
const PARENT_HAS_NO_PROJECT =
  'Link a project to this chat first: sub-chats start from a chat with a project.';

export type FolderExists = (path: string) => Promise<boolean>;

export class PlanFactsError extends Error {}

export async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

async function agentFacts(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<PlanAgent> {
  const capabilities = (await getCapabilities(db, workspaceId, provider)) ?? undefined;
  return {
    id: provider,
    name: catalogEntry(provider).name,
    models: (capabilities?.models ?? []).map(({ id, label }) => ({ id, label })),
    efforts: reportedEfforts(provider, capabilities?.efforts ?? null).map((effort) => effort.id),
    modes: modeChoices(provider, capabilities?.modes ?? []),
    capabilities,
  };
}

export async function connectedAgents(db: Queryable, workspaceId: string): Promise<PlanAgent[]> {
  const { rows } = await db.query<{ provider: ProviderId }>(
    `SELECT provider FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL ORDER BY provider`,
    [workspaceId],
  );
  return Promise.all(rows.map((row) => agentFacts(db, workspaceId, row.provider)));
}

async function primaryProjectId(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT project_id FROM conversation_projects WHERE conversation_id = $1
     ORDER BY position, created_at LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.project_id ?? null;
}

async function subChatTitles(db: Queryable, parentConversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ title: string }>(
    `SELECT c.title FROM sub_chats s JOIN conversations c ON c.id = s.conversation_id
     WHERE s.parent_conversation_id = $1`,
    [parentConversationId],
  );
  return rows.map((row) => row.title);
}

export async function planFacts(
  db: Queryable,
  workspaceId: string,
  parentConversationId: string,
  folderExists: FolderExists = isFolder,
): Promise<PlanFacts> {
  const settings = await resolveChatSettings(db, parentConversationId);
  if (!settings.provider) throw new PlanFactsError(PARENT_HAS_NO_AGENT);
  const projectId = await primaryProjectId(db, parentConversationId);
  if (!projectId) throw new PlanFactsError(PARENT_HAS_NO_PROJECT);
  const [projects, agents, existingTitles, posture] = await Promise.all([
    listProjects(db, workspaceId),
    connectedAgents(db, workspaceId),
    subChatTitles(db, parentConversationId),
    providerModePosture(db, workspaceId, settings.provider, settings.agentMode),
  ]);
  return {
    parent: {
      projectId,
      provider: settings.provider,
      model: settings.model,
      effort: settings.effort,
      agentMode: settings.agentMode,
      level: settings.level,
      posture,
    },
    projects: await Promise.all(
      projects.map(async ({ id, name, rootPath }) => ({
        id,
        name,
        folderExists: await folderExists(rootPath),
      })),
    ),
    agents,
    existingTitles,
    newId,
  };
}
