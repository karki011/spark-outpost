import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import { MUTATING_METHODS, loopbackHosts, refusedForShape } from '../api/security.ts';
import type { Db } from '../persistence/db.ts';
import { sendPairingPage } from './pairing-page.ts';
import { blockedFieldIn, cardSwitch, remoteDecision, switchRefusal } from './policy.ts';
import {
  admitDevice,
  blockedFieldsOf,
  markRemote,
  remoteDeviceOf,
  type RemoteDevicePrincipal,
} from './principal.ts';
import { deviceTokenOf, secretHash } from './session.ts';
import {
  approvalPayload,
  deviceByTokenHash,
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
]);
const NOT_LOCAL = 'Requests must target the local API host.';
const BAD_ORIGIN = 'This origin is not allowed.';
const NOT_PAIRED = 'Pair this device first.';
const PAIR_AGAIN = 'This device needs to pair again.';

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

  const answerUnpaired = (req: Request, res: Response) => {
    if (!isPageRequest(req)) {
      refuse(res, 401, NOT_PAIRED);
      return;
    }
    if (PUBLIC_FILES.has(req.path) && deps.webRoot) {
      res.sendFile(req.path.slice(1), { root: deps.webRoot });
      return;
    }
    sendPairingPage(res);
  };

  const cardRefusal = async (req: Request, switches: Record<string, boolean>) => {
    const id = uuid.safeParse(req.path.split('/')[3]);
    if (!id.success) return null;
    const payload = await approvalPayload(db, workspaceId, id.data);
    if (payload === null) return null;
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
        console.error('Could not record a phone request status', (error as Error).message);
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
      answerUnpaired(req, res);
      return;
    }
    const device = { id: row.id, name: row.name };
    const stale = staleReason(row);
    if (stale) {
      if (isPageRequest(req)) answerUnpaired(req, res);
      else await refuseDevice(req, res, device, 401, stale, PAIR_AGAIN);
      return;
    }
    if (decision.kind === 'refuse') {
      await refuseDevice(req, res, device, 403, 'policy', decision.reason);
      return;
    }
    const cardNeeds = decision.card ? await cardRefusal(req, access.switches) : null;
    if (cardNeeds) {
      await refuseDevice(req, res, device, 403, `switch:${cardNeeds}`, switchRefusal(cardNeeds));
      return;
    }
    admitDevice(res, device, decision.blockedFields);
    await touchDevice(db, device.id);
    if (mutating) await auditRequest(req, res, device);
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
      const field = blockedFieldIn(req.body, blockedFieldsOf(res));
      if (!device || !field) {
        next();
        return;
      }
      await refuseDevice(req, res, device, 403, 'switch:agentMode', switchRefusal('agentMode'));
    }) satisfies RequestHandler,
  };
}
