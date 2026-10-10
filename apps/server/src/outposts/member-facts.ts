import { shortModelLabel } from '@spark-outpost/contracts';
import { getCapabilities, resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import { cardFor } from '../model-cards/cards.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { agentLabel, type IntroFacts } from './handshake.ts';

export type MemberFacts = Omit<IntroFacts, 'handle'>;

async function chatPlace(
  db: Queryable,
  conversationId: string,
): Promise<{ workspaceId: string; project: string | null } | null> {
  const { rows } = await db.query<{ workspace_id: string; project: string | null }>(
    `SELECT c.workspace_id,
       (SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
        WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at LIMIT 1) AS project
     FROM conversations c WHERE c.id = $1`,
    [conversationId],
  );
  const row = rows[0];
  return row ? { workspaceId: row.workspace_id, project: row.project } : null;
}

function cardNameOf(modelId: string | null, provider: string): string | null {
  if (modelId === null) return null;
  return cardFor({ id: modelId }, provider)?.label ?? modelId;
}

export async function memberFacts(
  db: Queryable,
  conversationId: string,
): Promise<MemberFacts | null> {
  const place = await chatPlace(db, conversationId);
  if (!place) return null;
  const settings = await resolveChatSettings(db, conversationId);
  if (!settings.provider) return { project: place.project, agent: null, mode: null };
  const capabilities = await getCapabilities(db, place.workspaceId, settings.provider);
  const modelId = settings.model ?? capabilities?.defaultModel ?? null;
  const model = capabilities?.models.find((option) => option.id === modelId);
  const mode = capabilities?.modes.find((option) => option.id === settings.agentMode);
  return {
    project: place.project,
    agent: agentLabel({
      provider: catalogEntry(settings.provider).name,
      model: model ? shortModelLabel(model.label) : cardNameOf(modelId, settings.provider),
      auto: settings.routing === 'auto',
    }),
    mode: mode?.label ?? settings.agentMode,
  };
}
