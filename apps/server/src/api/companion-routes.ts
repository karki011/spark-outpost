import { Router } from 'express';
import { AssistantUnavailableError, ensureAssistantChat } from '../companion/assistant.ts';
import { chatUpdate } from '../companion/chat-update.ts';
import { chatFileView } from '../companion/file-view.ts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { ApiEndpoints } from '../setup/verify.ts';
import { paramId } from './validation.ts';

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

  router.post('/spark-assistant', async (_req, res) => {
    try {
      res.json({ conversationId: await ensureAssistantChat(deps.db, deps.workspaceId) });
    } catch (error) {
      if (!(error instanceof AssistantUnavailableError)) throw error;
      res.status(409).json({ error: error.message });
    }
  });

  return router;
}
