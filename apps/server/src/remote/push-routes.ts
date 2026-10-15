import { Router, type Response } from 'express';
import {
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  type PushState,
} from '@spark-outpost/contracts';
import { parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import type { PushKeys } from './push-keys.ts';
import { isPushEndpoint } from './push-plan.ts';
import { deletePushSubscription, devicePushEndpoints, savePushSubscription } from './push-store.ts';
import { remoteDeviceOf, type RemoteDevicePrincipal } from './principal.ts';
import { remoteAccess } from './store.ts';

export interface PushRouteDeps {
  db: Db;
  workspaceId: string;
  keys: PushKeys;
}

const NOT_FOUND = 'Not found.';
const NOT_A_PUSH_SERVICE = 'That address is not a browser push service.';
const NOT_SAVED = 'Notifications could not be turned on. Try again.';

export function pushRoutes(deps: PushRouteDeps): Router {
  const { db, workspaceId, keys } = deps;
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
