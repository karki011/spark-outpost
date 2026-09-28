import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  providerIdSchema,
  updateChatSettingsRequestSchema,
  type ProviderId,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { createConversation } from '../persistence/conversations.ts';
import {
  draftChatSettings,
  getCapabilities,
  resolveChatSettings,
  saveCapabilities,
  updateChatSettings,
  type CapabilitySnapshot,
} from '../persistence/chat-settings.ts';
import { activeConnection } from '../persistence/setup.ts';
import { setConversationProjects } from '../persistence/conversation-projects.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
} from '../persistence/provider-sessions.ts';
import type { DbClient } from '../persistence/db.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface ChatSettingsDeps {
  db: Db;
  workspaceId: string;
  probeCapabilities: (provider: ProviderId) => Promise<CapabilitySnapshot>;
}

const idParam = z.uuid();

async function sessionShape(client: DbClient, id: string) {
  const settings = await resolveChatSettings(client, id);
  const { rows } = await client.query<{ project_id: string }>(
    `SELECT project_id FROM conversation_projects WHERE conversation_id = $1
     ORDER BY position, created_at`,
    [id],
  );
  return {
    settings: JSON.stringify({
      ...settings,
      level: null,
      agentMode: null,
      options: null,
      permission: settings.permission,
    }),
    repos: rows.map((row) => row.project_id).join(),
  };
}

function changeReason(
  before: Awaited<ReturnType<typeof sessionShape>>,
  after: Awaited<ReturnType<typeof sessionShape>>,
): string | null {
  if (before.repos !== after.repos) return SESSION_CLOSE_REASONS.repos;
  return before.settings === after.settings ? null : SESSION_CLOSE_REASONS.settings;
}

async function requestModeChange(
  client: DbClient,
  conversationId: string,
  provider: string,
  mode: string,
): Promise<void> {
  await client.query(
    `UPDATE runs SET
       agent_mode = CASE WHEN status = 'queued' THEN $3 ELSE agent_mode END,
       requested_mode = CASE WHEN status = 'queued' THEN requested_mode ELSE $3 END
     WHERE conversation_id = $1 AND provider = $2 AND mode = 'do'
       AND status IN ('queued', 'running', 'awaiting_approval')
       AND (role IS NULL OR role = 'builder')`,
    [conversationId, provider, mode],
  );
}

function conversationId(req: Request): string {
  const result = idParam.safeParse(req.params.id);
  if (!result.success) throw new BadRequestError('The id must be a UUID.');
  return result.data;
}

export function chatSettingsRoutes({ db, workspaceId, probeCapabilities }: ChatSettingsDeps) {
  const router = Router();
  const probing = new Map<string, Promise<void>>();
  const probedForModes = new Set<string>();

  router.patch('/conversations/:id/settings', async (req, res) => {
    const { projectIds, ...update } = parseBody(updateChatSettingsRequestSchema, req);
    const id = conversationId(req);
    const settings = await withTransaction(db, async (client) => {
      await createConversation(client, workspaceId, id);
      const before = await sessionShape(client, id);
      if (projectIds !== undefined) {
        await setConversationProjects(client, workspaceId, id, projectIds);
      }
      const saved =
        Object.keys(update).length === 0
          ? await resolveChatSettings(client, id)
          : await updateChatSettings(client, id, update);
      const reason = changeReason(before, await sessionShape(client, id));
      if (reason) await closeConversationSessions(client, workspaceId, id, reason);
      if (update.agentMode && saved.provider && saved.agentMode) {
        await requestModeChange(client, id, saved.provider, saved.agentMode);
      }
      return saved;
    });
    res.json(settings);
  });

  router.get('/chat-settings/defaults', async (_req, res) => {
    res.json(await draftChatSettings(db, workspaceId));
  });

  router.get('/providers/:provider/capabilities', async (req, res) => {
    const parsed = providerIdSchema.safeParse(req.params.provider);
    if (!parsed.success) throw new BadRequestError('Unknown provider.');
    const provider = parsed.data;
    if (!(await activeConnection(db, workspaceId, provider))) {
      throw new BadRequestError('Connect this provider first.');
    }
    const cached = await getCapabilities(db, workspaceId, provider);
    const lacksModes =
      cached !== null && cached.modes.length === 0 && !probedForModes.has(provider);
    if (cached && req.query.refresh !== '1' && !lacksModes) {
      res.json(cached);
      return;
    }
    probedForModes.add(provider);
    let pending = probing.get(provider);
    if (!pending) {
      pending = probeCapabilities(provider)
        .then((snapshot) => saveCapabilities(db, workspaceId, snapshot))
        .finally(() => probing.delete(provider));
      probing.set(provider, pending);
    }
    await pending;
    res.json(await getCapabilities(db, workspaceId, provider));
  });

  return router;
}
