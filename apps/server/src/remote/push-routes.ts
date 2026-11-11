import { Router, type Response } from 'express';
import {
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  updatePushContactRequestSchema,
  type PushContactState,
  type PushState,
  type PushTestResult,
} from '@spark-outpost/contracts';
import { parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import type { PushKeys } from './push-keys.ts';
import { isPushEndpoint } from './push-plan.ts';
import { normalizePushContact, pushContactProblem, pushSubject } from './push-contact.ts';
import {
  deletePushSubscription,
  devicePushEndpoints,
  lastPushFailures,
  pushContact,
  savePushContact,
  savePushSubscription,
} from './push-store.ts';
import { remoteDeviceOf, type RemoteDevicePrincipal } from './principal.ts';
import { listDevices, recordRemoteAudit, remoteAccess } from './store.ts';

export interface PushRouteDeps {
  db: Db;
  workspaceId: string;
  keys: PushKeys;
  test?: ((deviceId: string) => Promise<PushTestResult>) | undefined;
}

const NOT_FOUND = 'Not found.';
const NOT_A_PUSH_SERVICE = 'That address is not a browser push service.';
const NOT_SAVED = 'Notifications could not be turned on. Try again.';

export function pushRoutes(deps: PushRouteDeps): Router {
  const { db, workspaceId, keys, test } = deps;
  const router = Router();

  const pairedDevice = (res: Response): RemoteDevicePrincipal | null => {
    const device = remoteDeviceOf(res);
    if (!device) res.status(404).json({ error: NOT_FOUND });
    return device;
  };

  const stateOf = async (deviceId: string): Promise<PushState> => {
    const { publicKey } = await keys.get();
    return {
      publicKey,
      endpoints: await devicePushEndpoints(db, workspaceId, deviceId, publicKey),
    };
  };

  const contactState = async (): Promise<PushContactState> => {
    const [contact, { hostname }] = await Promise.all([
      pushContact(db, workspaceId),
      remoteAccess(db, workspaceId),
    ]);
    return {
      contact,
      inUse: pushSubject(contact, hostname),
      failures: await lastPushFailures(db, workspaceId),
    };
  };

  const onTheMac = (res: Response): boolean => {
    if (remoteDeviceOf(res) === null) return true;
    res.status(404).json({ error: NOT_FOUND });
    return false;
  };

  router.get('/remote/push/contact', async (_req, res) => {
    if (!onTheMac(res)) return;
    res.set('Cache-Control', 'no-store').json(await contactState());
  });

  router.put('/remote/push/contact', async (req, res) => {
    if (!onTheMac(res)) return;
    const { contact: raw } = parseBody(updatePushContactRequestSchema, req);
    const contact = raw === null || raw === '' ? null : normalizePushContact(raw);
    if (contact !== null) {
      const problem = pushContactProblem(contact, (await remoteAccess(db, workspaceId)).hostname);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }
    }
    await savePushContact(db, workspaceId, contact);
    await recordRemoteAudit(db, workspaceId, {
      action: 'push_contact_changed',
      detail: { set: contact !== null },
    });
    res.json(await contactState());
  });

  router.post('/remote/devices/:id/push/test', async (req, res) => {
    if (!onTheMac(res)) return;
    const device = (await listDevices(db, workspaceId)).find((row) => row.id === req.params.id);
    if (!test || !device || device.revoked_at !== null) {
      res.status(404).json({ error: NOT_FOUND });
      return;
    }
    res.json(await test(device.id));
  });

  router.get('/remote/push', async (_req, res) => {
    const device = pairedDevice(res);
    if (!device) return;
    res.set('Cache-Control', 'no-store').json(await stateOf(device.id));
  });

  router.put('/remote/push/subscription', async (req, res) => {
    const device = pairedDevice(res);
    if (!device) return;
    const subscription = parseBody(pushSubscribeRequestSchema, req);
    if (!isPushEndpoint(subscription.endpoint)) {
      res.status(400).json({ error: NOT_A_PUSH_SERVICE });
      return;
    }
    const { hostname } = await remoteAccess(db, workspaceId);
    const { publicKey } = await keys.get();
    const saved =
      hostname !== null &&
      (await savePushSubscription(db, workspaceId, {
        deviceId: device.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        hostname,
        serverKey: publicKey,
      }));
    if (!saved) {
      res.status(409).json({ error: NOT_SAVED });
      return;
    }
    res.json(await stateOf(device.id));
  });

  router.delete('/remote/push/subscription', async (req, res) => {
    const device = pairedDevice(res);
    if (!device) return;
    const { endpoint } = parseBody(pushUnsubscribeRequestSchema, req);
    await deletePushSubscription(db, workspaceId, device.id, endpoint);
    res.json(await stateOf(device.id));
  });

  return router;
}
