import { Router, type Request, type Response } from 'express';
import {
  pairingClaimRequestSchema,
  pairingSubmitRequestSchema,
  renameRemoteDeviceRequestSchema,
  updateRemoteAccessRequestSchema,
  updateRemoteSwitchesRequestSchema,
  type PairingClaimResponse,
  type PairingSubmitResponse,
  type PendingPairingList,
  type RemoteAuditList,
  type RemoteDevice,
  type RemoteDeviceList,
  type RemoteSession,
} from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { RateLimitError } from './attempt-window.ts';
import type { Pairings } from './pairing.ts';
import type { PasskeyChallenges } from './passkey-challenges.ts';
import { passkeyRoutes, toPasskey } from './passkey-routes.ts';
import type { PushKeys } from './push-keys.ts';
import { pushRoutes } from './push-routes.ts';
import {
  devicePasskeys,
  listPasskeys,
  removeDevicePasskeys,
  type PasskeyRow,
} from './passkey-store.ts';
import { isRemote, remoteDeviceOf } from './principal.ts';
import { deviceCookie, deviceTokenOf, newSecret, secretHash } from './session.ts';
import {
  addDevice,
  deviceByTokenHash,
  listDevices,
  listRemoteAudit,
  markDeviceReplaced,
  recordRemoteAudit,
  remoteAccess,
  renameDevice,
  repairDevice,
  revokeAllDevices,
  revokeDevice,
  saveRemoteHostname,
  saveRemoteSwitches,
  type AuditInput,
  type DeviceRow,
} from './store.ts';
import type { DeviceStreams } from './streams.ts';
import type { TailscaleServe } from './tailscale.ts';

export interface RemoteRouteDeps {
  db: Db;
  workspaceId: string;
  pairings: Pairings;
  challenges: PasskeyChallenges;
  streams: DeviceStreams;
  tailscale: TailscaleServe;
  pushKeys: PushKeys;
  attemptsPerMinute?: number | undefined;
}

const BAD_CODE = 'That code is not valid. Start pairing again on your Mac.';
const PAIRING_GONE = 'This pairing ended. Start again on your Mac.';
const NO_PAIRING = 'That pairing request is no longer waiting.';
const NO_DEVICE = 'Device not found.';
const MAC_ONLY = 'This is only available on your Mac.';

function sameNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function remoteRoutes(deps: RemoteRouteDeps): Router {
  const { db, workspaceId, pairings, challenges, streams, tailscale } = deps;
  const router = Router();
  const audit = (entry: AuditInput) => recordRemoteAudit(db, workspaceId, entry);

  const toDevice = (
    row: DeviceRow,
    passkeys: PasskeyRow[],
    newerSameName: DeviceRow | null = null,
  ): RemoteDevice => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    replacedBy: row.replaced_by,
    duplicateOf: newerSameName && !streams.connected(row.id) ? newerSameName.id : null,
    expired: row.expired,
    connected: streams.connected(row.id),
    passkeys: passkeys.map(toPasskey),
  });

  const deviceList = async (): Promise<RemoteDeviceList> => {
    const rows = await listDevices(db, workspaceId);
    const passkeys = new Map<string, PasskeyRow[]>();
    for (const passkey of await listPasskeys(db, workspaceId)) {
      passkeys.set(passkey.device_id, [...(passkeys.get(passkey.device_id) ?? []), passkey]);
    }
    const newestByName = new Map<string, DeviceRow>();
    for (const row of rows) {
      if (!row.revoked_at) newestByName.set(sameNameKey(row.name), row);
    }
    return {
      devices: rows.map((row) => {
        const newest = row.revoked_at ? null : newestByName.get(sameNameKey(row.name));
        const newer = newest && newest.id !== row.id ? newest : null;
        return toDevice(row, passkeys.get(row.id) ?? [], newer);
      }),
    };
  };

  const pairClaimed = async (req: Request, pairingId: string, name: string, tokenHash: string) => {
    const carried = deviceTokenOf(req.headers.cookie);
    const carriedHash = carried ? secretHash(carried) : null;
    const known = carriedHash ? await deviceByTokenHash(db, workspaceId, carriedHash) : null;
    const same =
      known && carriedHash
        ? await repairDevice(db, workspaceId, known.id, { name, tokenHash, carriedHash })
        : null;
    if (same) {
      await audit({
        action: 'device_paired_again',
        device: { id: same.id, name: same.name },
        detail: { pairingId },
      });
      return;
    }
    const device = await addDevice(db, workspaceId, { name, tokenHash });
    if (known) {
      await markDeviceReplaced(db, workspaceId, known.id, device.id);
      streams.close(known.id);
    }
    await audit({
      action: 'device_paired',
      device: { id: device.id, name: device.name },
      detail: { pairingId, replaced: known?.id },
    });
  };

  const limited = async (res: Response, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      res.status(429).json({ error: error.message });
    }
  };

  const remoteOnly = (res: Response): boolean => {
    if (isRemote(res)) return true;
    res.status(404).json({ error: 'Not found.' });
    return false;
  };

  router.post('/remote/pair', async (req, res) => {
    if (!remoteOnly(res)) return;
    const { code, deviceName } = parseBody(pairingSubmitRequestSchema, req);
    await limited(res, async () => {
      const submitted = pairings.submit(code, deviceName);
      if (!submitted) {
        await audit({ action: 'pairing_failed', detail: { reason: 'code' } });
        res.status(403).json({ error: BAD_CODE });
        return;
      }
      await audit({
        action: 'pairing_submitted',
        detail: { pairingId: submitted.id, deviceName },
      });
      const body: PairingSubmitResponse = {
        claim: submitted.claim,
        matchCode: submitted.matchCode,
        expiresAt: submitted.expiresAt,
      };
      res.set('Cache-Control', 'no-store').json(body);
    });
  });

  router.post('/remote/pair/claim', async (req, res) => {
    if (!remoteOnly(res)) return;
    const { claim } = parseBody(pairingClaimRequestSchema, req);
    const result = pairings.claim(claim);
    if (!result) {
      res.status(403).json({ error: PAIRING_GONE });
      return;
    }
    res.set('Cache-Control', 'no-store');
    if (result.status === 'waiting') {
      res.status(202).json({ status: 'waiting' } satisfies PairingClaimResponse);
      return;
    }
    const token = newSecret();
    await pairClaimed(req, result.id, result.deviceName, secretHash(token));
    res
      .set('Set-Cookie', deviceCookie(token))
      .json({ status: 'paired' } satisfies PairingClaimResponse);
  });

  router.use(
    passkeyRoutes({ db, workspaceId, challenges, attemptsPerMinute: deps.attemptsPerMinute }),
  );
  router.use(pushRoutes({ db, workspaceId, keys: deps.pushKeys }));

  router.get('/remote/switches', async (_req, res) => {
    res.json((await remoteAccess(db, workspaceId)).switches);
  });

  router.get('/remote/session', async (_req, res) => {
    const access = await remoteAccess(db, workspaceId);
    const session: RemoteSession = {
      remote: isRemote(res),
      device: remoteDeviceOf(res),
      address: access.hostname ? `https://${access.hostname}` : null,
      switches: access.switches,
    };
    res.json(session);
  });

  router.use('/remote', (_req: Request, res: Response, next) => {
    if (isRemote(res)) {
      res.status(403).json({ error: MAC_ONLY });
      return;
    }
    next();
  });

  router.get('/remote/access', async (_req, res) => {
    res.json(await remoteAccess(db, workspaceId));
  });

  router.put('/remote/access', async (req, res) => {
    const { hostname } = parseBody(updateRemoteAccessRequestSchema, req);
    const before = await remoteAccess(db, workspaceId);
    const saved = await saveRemoteHostname(db, workspaceId, hostname);
    if (before.hostname !== saved.hostname) {
      streams.closeAll();
      await audit({ action: 'hostname_changed', detail: { on: saved.hostname !== null } });
    }
    res.json(saved);
  });

  router.get('/remote/tailscale', async (_req, res) => {
    res.json(await tailscale.state());
  });

  router.post('/remote/tailscale/on', async (_req, res) => {
    res.json(await tailscale.turnOn());
  });

  router.post('/remote/tailscale/off', async (_req, res) => {
    res.json(await tailscale.turnOff());
  });

  router.patch('/remote/switches', async (req, res) => {
    const change = parseBody(updateRemoteSwitchesRequestSchema, req);
    const saved = await saveRemoteSwitches(db, workspaceId, change);
    await audit({ action: 'switches_changed', detail: change });
    res.json(saved.switches);
  });

  router.get('/remote/devices', async (_req, res) => {
    res.json(await deviceList());
  });

  router.patch('/remote/devices/:id', async (req, res) => {
    const { name } = parseBody(renameRemoteDeviceRequestSchema, req);
    const device = await renameDevice(db, workspaceId, paramId(req), name);
    if (!device) {
      res.status(404).json({ error: NO_DEVICE });
      return;
    }
    await audit({ action: 'device_renamed', device: { id: device.id, name: device.name } });
    res.json(toDevice(device, await devicePasskeys(db, workspaceId, device.id)));
  });

  router.delete('/remote/devices/:id/passkeys', async (req, res) => {
    const id = paramId(req);
    const device = (await listDevices(db, workspaceId)).find((row) => row.id === id);
    if (!device) {
      res.status(404).json({ error: NO_DEVICE });
      return;
    }
    const count = await removeDevicePasskeys(db, workspaceId, device.id);
    streams.close(device.id);
    await audit({
      action: 'device_passkeys_removed',
      device: { id: device.id, name: device.name },
      detail: { count },
    });
    res.json(await deviceList());
  });

  router.delete('/remote/devices/:id', async (req, res) => {
    const device = await revokeDevice(db, workspaceId, paramId(req));
    if (!device) {
      res.status(404).json({ error: NO_DEVICE });
      return;
    }
    streams.close(device.id);
    await audit({ action: 'device_revoked', device: { id: device.id, name: device.name } });
    res.json(await deviceList());
  });

  router.post('/remote/devices/disconnect-all', async (_req, res) => {
    const revoked = await revokeAllDevices(db, workspaceId);
    streams.closeAll();
    await audit({ action: 'devices_disconnected', detail: { count: revoked.length } });
    res.json(await deviceList());
  });

  router.post('/remote/pairings', async (_req, res) => {
    await limited(res, async () => {
      const started = pairings.start();
      await audit({ action: 'pairing_started', detail: { pairingId: started.id } });
      res.status(201).set('Cache-Control', 'no-store').json(started);
    });
  });

  router.get('/remote/pairings', (_req, res) => {
    res.json({ pairings: pairings.pending() } satisfies PendingPairingList);
  });

  router.post('/remote/pairings/:id/confirm', async (req, res) => {
    const pairing = pairings.confirm(paramId(req));
    if (!pairing) {
      res.status(409).json({ error: NO_PAIRING });
      return;
    }
    await audit({
      action: 'pairing_confirmed',
      detail: { pairingId: pairing.id, deviceName: pairing.deviceName },
    });
    res.json({ pairings: pairings.pending() } satisfies PendingPairingList);
  });

  router.post('/remote/pairings/:id/deny', async (req, res) => {
    const pairing = pairings.deny(paramId(req));
    if (!pairing) {
      res.status(409).json({ error: NO_PAIRING });
      return;
    }
    await audit({
      action: 'pairing_denied',
      detail: { pairingId: pairing.id, deviceName: pairing.deviceName },
    });
    res.json({ pairings: pairings.pending() } satisfies PendingPairingList);
  });

  router.get('/remote/audit', async (_req, res) => {
    res.json({ entries: await listRemoteAudit(db, workspaceId) } satisfies RemoteAuditList);
  });

  return router;
}
