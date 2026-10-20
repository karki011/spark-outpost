import { Router, type Response } from 'express';
import {
  assistantHistoryQuerySchema,
  assistantSettingsSchema,
  clearAssistantRequestSchema,
} from '@spark-outpost/contracts';
import { AssistantUnavailableError, ensureAssistantChat } from '../companion/assistant.ts';
import { listAssistantEvents } from '../companion/assistant-events.ts';
import { listAssistantHistory } from '../companion/assistant-history.ts';
import { removeFact } from '../companion/assistant-facts.ts';
import {
  AssistantSettingsError,
  assistantView,
  clearAssistantHistory,
  saveAssistantSettings,
  startAssistantTopic,
} from '../companion/assistant-settings.ts';
import { chatUpdate } from '../companion/chat-update.ts';
import { chatFileView } from '../companion/file-view.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { ApiEndpoints } from '../setup/verify.ts';
import { paramId, parseBody, parseQuery } from './validation.ts';

export interface CompanionRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  endpoints: ApiEndpoints;
}

export function companionRoutes(deps: CompanionRouteDeps): Router {
  const router = Router();
  const jev = {
    db: deps.db,
    secrets: deps.secrets,
    fetch: deps.endpoints.fetch,
    baseUrl: deps.endpoints.typesafeBaseUrl,
  };

  router.post('/conversations/:id/update', async (req, res) => {
    const update = await chatUpdate(
      { db: deps.db, workspaceId: deps.workspaceId, jev },
      paramId(req),
    );
    if (!update) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(update);
  });

  router.get('/conversations/:id/file-view', async (req, res) => {
    res.json(await chatFileView(deps.db, deps.workspaceId, paramId(req)));
  });

  const answer = async (res: Response, work: () => Promise<unknown>) => {
    try {
      res.json(await work());
    } catch (error) {
      const unavailable =
        error instanceof AssistantUnavailableError || error instanceof AssistantSettingsError;
      if (!unavailable) throw error;
      res.status(409).json({ error: error.message });
    }
  };

  router.post('/spark-assistant', async (_req, res) => {
    await answer(res, async () => ({
      conversationId: await ensureAssistantChat(deps.db, deps.workspaceId),
    }));
  });

  router.get('/spark-assistant/settings', async (_req, res) => {
    await answer(res, () => assistantView(deps.db, deps.workspaceId));
  });

  router.put('/spark-assistant/settings', async (req, res) => {
    const settings = parseBody(assistantSettingsSchema, req);
    await answer(res, () =>
      withTransaction(deps.db, (client) =>
        saveAssistantSettings(client, deps.workspaceId, settings),
      ),
    );
  });

  router.post('/spark-assistant/clear', async (req, res) => {
    const options = parseBody(clearAssistantRequestSchema, req);
    await answer(res, () =>
      withTransaction(deps.db, (client) =>
        clearAssistantHistory(client, deps.workspaceId, options),
      ),
    );
  });

  router.post('/spark-assistant/topic', async (_req, res) => {
    await answer(res, () =>
      withTransaction(deps.db, (client) => startAssistantTopic(client, deps.workspaceId)),
    );
  });

  router.get('/spark-assistant/history', async (req, res) => {
    const query = parseQuery(assistantHistoryQuerySchema, req);
    res.json(await listAssistantHistory(deps.db, deps.workspaceId, query));
  });

  router.delete('/spark-assistant/facts/:id', async (req, res) => {
    await removeFact(deps.db, deps.workspaceId, paramId(req));
    await answer(res, () => assistantView(deps.db, deps.workspaceId));
  });

  router.get('/spark-assistant/events', async (_req, res) => {
    res.json({ events: await listAssistantEvents(deps.db, deps.workspaceId) });
  });

  return router;
}
