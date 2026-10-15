import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { MUTATING_METHODS, loopbackHosts, refusedForShape } from '../api/security.ts';
import type { Db } from '../persistence/db.ts';
import { entryTarget, isEntryReturn, mayHaveLostCookie, sendEntryBounce } from './entry-bounce.ts';
import { sendPairingPage } from './pairing-page.ts';
import {
  MAC_CARD_REFUSAL,
  blockedFieldIn,
  cardSwitch,
  macOnlyCard,
  remoteDecision,
  switchRefusal,
} from './policy.ts';
import {
  admitDevice,
  blockedFieldsOf,
  markRemote,
  remoteDeviceOf,
  type RemoteDevicePrincipal,
} from './principal.ts';
import { asDevice } from './run-mark.ts';
import { deviceTokenOf, secretHash } from './session.ts';
import {
  approvalPayload,
  deviceByTokenHash,
  recordPairingPageShown,
  recordRemoteAudit,
  remoteAccess,
  setRemoteAuditStatus,
  touchDevice,
  type DeviceRow,
} from './store.ts';
import type { DeviceStreams } from './streams.ts';

export interface GatewayDeps {
  db: Db;
  workspaceId: string;
  port: number;
  webRoot?: string | undefined;
  streams: DeviceStreams;
}

const PUBLIC_FILES = new Set([
  '/theme.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/sw.js',
]);
const NOT_LOCAL = 'Requests must target the local API host.';
const BAD_ORIGIN = 'This origin is not allowed.';
const NOT_PAIRED = 'Pair this device first.';
const PAIR_AGAIN = 'This device needs to pair again.';
const PAIRING_PAGE_AUDIT_EVERY_SECONDS = 60;
const ASSET_PATH = /\.[a-z0-9]+$/i;
const UNAUDITED_WRITES = new Set(['POST /api/slack/presence']);

const uuid = z.uuid();

function refuse(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function runLocal(
  guards: readonly RequestHandler[],
  req: Request,
  res: Response,
  done: NextFunction,
) {
  const step = (index: number): void => {
    const guard = guards[index];
    if (!guard) {
      done();
      return;
    }
    void guard(req, res, (error?: unknown) => {
      if (error) done(error);
      else step(index + 1);
    });
  };
  step(0);
}

function isPageRequest(req: Request): boolean {
  const reads = req.method === 'GET' || req.method === 'HEAD';
  return reads && !/^\/api(\/|$)/i.test(req.path);
}

function wantsStream(req: Request): boolean {
  return req.headers.accept?.includes('text/event-stream') === true;
}

function audited(req: Request): boolean {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  return !UNAUDITED_WRITES.has(`${req.method} ${path}`);
}

function staleReason(device: DeviceRow): string | null {
  if (device.revoked_at) return 'revoked';
  return device.expired ? 'unused' : null;
}

export function remoteGateway(deps: GatewayDeps) {
  const { db, workspaceId, streams } = deps;
  const loopback = loopbackHosts(deps.port);

  const refuseDevice = async (
    req: Request,
    res: Response,
    device: RemoteDevicePrincipal,
    status: number,
    reason: string,
    error: string,
  ) => {
    await recordRemoteAudit(db, workspaceId, {
      action: 'refused',
      device,
      method: req.method,
      path: req.path,
      status,
      detail: { reason },
    });
    refuse(res, status, error);
  };

  const auditPairingPage = (reason: string, device: RemoteDevicePrincipal | null) =>
    recordPairingPageShown(db, workspaceId, device, reason, PAIRING_PAGE_AUDIT_EVERY_SECONDS);

  const answerUnpaired = async (
    req: Request,
    res: Response,
    reason: string,
    passkeys: boolean,
    device: RemoteDevicePrincipal | null = null,
  ) => {
    if (!isPageRequest(req)) {
      refuse(res, 401, NOT_PAIRED);
      return;
    }
    if (PUBLIC_FILES.has(req.path) && deps.webRoot) {
      res.sendFile(req.path.slice(1), { root: deps.webRoot });
      return;
    }
    if (reason === 'missing' && mayHaveLostCookie(req)) {
      sendEntryBounce(res);
      return;
    }
    await auditPairingPage(reason, device);
    sendPairingPage(res, { passkeys });
  };

  const cardRefusal = async (req: Request, switches: Record<string, boolean>) => {
    const id = uuid.safeParse(req.path.split('/')[3]);
    if (!id.success) return null;
    const payload = await approvalPayload(db, workspaceId, id.data);
    if (payload === null) return null;
    if (macOnlyCard(payload)) return 'mac';
    const needed = cardSwitch(payload);
    return needed && !switches[needed] ? needed : null;
  };

  const auditRequest = async (req: Request, res: Response, device: RemoteDevicePrincipal) => {
    const id = await recordRemoteAudit(db, workspaceId, {
      action: 'request',
      device,
      method: req.method,
      path: req.path,
    });
    res.once('finish', () => {
      setRemoteAuditStatus(db, id, res.statusCode).catch((error: unknown) => {
        console.error('Could not record a remote request status', (error as Error).message);
      });
    });
  };

  const admitRemote = async (req: Request, res: Response, next: NextFunction) => {
    const access = await remoteAccess(db, workspaceId);
    const host = (req.headers.host ?? '').toLowerCase();
    if (!access.hostname || host !== access.hostname) {
      refuse(res, 403, NOT_LOCAL);
      return;
    }
    const origin = req.headers.origin;
    const mutating = MUTATING_METHODS.has(req.method);
    if (origin ? origin !== `https://${access.hostname}` : mutating) {
      refuse(res, 403, BAD_ORIGIN);
      return;
    }
    if (refusedForShape(req, res)) return;
    delete req.headers[API_TOKEN_HEADER];
    markRemote(res);

    const decision = remoteDecision(req.method, req.path, access.switches);
    if (decision.kind === 'pairing') {
      next();
      return;
    }
    const token = deviceTokenOf(req.headers.cookie);
    const row = token ? await deviceByTokenHash(db, workspaceId, secretHash(token)) : null;
    if (!row) {
      await answerUnpaired(req, res, token ? 'unknown' : 'missing', access.switches.passkeys);
      return;
    }
    const device = { id: row.id, name: row.name };
    const stale = staleReason(row);
    if (stale) {
      if (isPageRequest(req)) {
        await answerUnpaired(req, res, stale, access.switches.passkeys, device);
      } else {
        await refuseDevice(req, res, device, 401, stale, PAIR_AGAIN);
      }
      return;
    }
    if (decision.kind === 'refuse') {
      await refuseDevice(req, res, device, 403, 'policy', decision.reason);
      return;
    }
    const cardNeeds = decision.card ? await cardRefusal(req, access.switches) : null;
    if (cardNeeds === 'mac') {
      await refuseDevice(req, res, device, 403, 'policy', MAC_CARD_REFUSAL);
      return;
    }
    if (cardNeeds) {
      await refuseDevice(req, res, device, 403, `switch:${cardNeeds}`, switchRefusal(cardNeeds));
      return;
    }
    admitDevice(res, device, decision.blockedFields);
    await touchDevice(db, device.id);
    if (isPageRequest(req) && isEntryReturn(req)) {
      res.set('Cache-Control', 'no-store').redirect(302, entryTarget(req));
      return;
    }
    if (isPageRequest(req) && !ASSET_PATH.test(req.path)) res.set('Cache-Control', 'no-store');
    if (mutating && audited(req)) await auditRequest(req, res, device);
    if (wantsStream(req)) streams.track(device.id, res);
    next();
  };

  return {
    guard(local: readonly RequestHandler[]): RequestHandler {
      return (req, res, next) => {
        if (loopback.has(req.headers.host ?? '')) {
          runLocal(local, req, res, next);
          return;
        }
        admitRemote(req, res, next).catch(next);
      };
    },

    bodyGuard: (async (req, res, next) => {
      const device = remoteDeviceOf(res);
      if (device && req.body?.sessionType === 'terminal') {
        await refuseDevice(req, res, device, 403, 'policy', 'Terminal sessions stay on the Mac.');
        return;
      }
      const field = blockedFieldIn(req.body, blockedFieldsOf(res));
      if (!device) {
        next();
        return;
      }
      if (!field) {
        asDevice(device.id, () => next());
        return;
      }
      await refuseDevice(req, res, device, 403, 'switch:agentMode', switchRefusal('agentMode'));
    }) satisfies RequestHandler,
  };
}
