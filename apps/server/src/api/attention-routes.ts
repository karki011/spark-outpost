import { Router } from 'express';
import type { AttentionList, AttentionMark } from '@spark-outpost/contracts';
import { markConversationSeen } from '../persistence/conversation-actions.ts';
import type { Db } from '../persistence/db.ts';
import { listAttentionItems, markAttention } from '../persistence/attention-items.ts';
import { paramId } from './validation.ts';
import { earliestMacOnlyCard, macOnlyAttentionKey } from '../remote/card-place.ts';
import { remoteDeviceOf } from '../remote/principal.ts';

export interface AttentionRouteDeps {
  db: Db;
  workspaceId: string;
}

const MARKS: readonly AttentionMark[] = ['read', 'set-aside', 'dismiss'];

export function attentionRoutes({ db, workspaceId }: AttentionRouteDeps): Router {
  const router = Router();

  router.get('/attention', async (_req, res) => {
    const list: AttentionList = { items: await listAttentionItems(db, workspaceId) };
    res.json(list);
  });

  router.post('/attention/chats/:id/read', async (req, res) => {
    const id = paramId(req);
    const device = remoteDeviceOf(res);
    const before = device ? await earliestMacOnlyCard(db, workspaceId, device.id, id) : null;
    await markConversationSeen(db, workspaceId, id, before);
    res.status(204).end();
  });

  for (const mark of MARKS) {
    router.post(`/attention/:key/${mark}`, async (req, res) => {
      const key = String(req.params.key);
      const device = remoteDeviceOf(res);
      const keepForMac =
        mark === 'read' && device && (await macOnlyAttentionKey(db, workspaceId, device.id, key));
      if (!keepForMac) await markAttention(db, workspaceId, key, mark);
      res.status(204).end();
    });
  }

  return router;
}
