import { hostname as computerHostname } from 'node:os';
import { Router } from 'express';
import {
  REMOTE_DEVICE_NAME_MAX,
  SPARK_ADDRESS_PROBLEMS,
  addRemoteSparkRequestSchema,
  parseSparkAddress,
  reachOfHostname,
  renameRemoteSparkRequestSchema,
  type RemoteSpark,
  type RemoteSparkList,
} from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { remoteAccess } from '../remote/store.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { RemoteSparkLink, RemoteSparkPort } from './bridge.ts';
import { iconPathOf, sparkIconRoutes, toLocalSpark } from './icon-routes.ts';
import { forgetSparkCookie, savedSparkCookie } from './secrets.ts';
import {
  RemoteSparkTakenError,
  addRemoteSpark,
  deleteRemoteSpark,
  listRemoteSparks,
  localSpark,
  markRemoteSparkOpened,
  remoteSpark,
  renameRemoteSpark,
  type RemoteSparkRow,
} from './store.ts';

export interface RemoteSparkRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  remoteSparkPort?: RemoteSparkPort | null | undefined;
  thisMacName?: string | undefined;
}

const NO_SPARK = 'That saved Spark was not found.';
const NO_DESKTOP_APP = 'Open another Mac’s Spark from the Spark Outpost app on this Mac.';
const FALLBACK_NAME = 'Mac';

export function macNameOf(hostname: string): string {
  const name = hostname
    .replace(/\.local\.?$/i, '')
    .trim()
    .slice(0, REMOTE_DEVICE_NAME_MAX)
    .trim();
  return name === '' ? FALLBACK_NAME : name;
}

export function remoteSparkRoutes(deps: RemoteSparkRouteDeps, link: RemoteSparkLink): Router {
  const { db, workspaceId, secrets } = deps;
  const port = link.port;
  const defaultName = macNameOf(deps.thisMacName ?? computerHostname());
  const router = Router();

  const toSpark = async (row: RemoteSparkRow): Promise<RemoteSpark> => {
    const paired = (await savedSparkCookie(secrets, row.id)) !== null;
    return {
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      reach: reachOfHostname(row.hostname),
      paired,
      ...link.stateOf(row.id, paired),
      icon: iconPathOf(row.id, row.icon_version),
      createdAt: row.created_at.toISOString(),
      lastOpenedAt: row.last_opened_at?.toISOString() ?? null,
    };
  };

  const open = async (
    openPort: RemoteSparkPort,
    row: RemoteSparkRow,
    code: string | null,
  ): Promise<RemoteSparkRow> => {
    openPort.post({
      kind: 'remote-spark:open',
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      deviceName: (await localSpark(db, workspaceId)).name ?? defaultName,
      code,
      cookie: await savedSparkCookie(secrets, row.id),
    });
    return (await markRemoteSparkOpened(db, workspaceId, row.id)) ?? row;
  };

  router.use(sparkIconRoutes({ db, workspaceId, defaultName, noSpark: NO_SPARK, toSpark }));

  router.get('/remote-sparks', async (_req, res) => {
    const rows = await listRemoteSparks(db, workspaceId);
    const list: RemoteSparkList = {
      available: port !== null,
      local: toLocalSpark(await localSpark(db, workspaceId), defaultName),
      sparks: await Promise.all(rows.map(toSpark)),
    };
    res.json(list);
  });

  router.post('/remote-sparks', async (req, res) => {
    const body = parseBody(addRemoteSparkRequestSchema, req);
    const own = (await remoteAccess(db, workspaceId)).hostname;
    const address = parseSparkAddress(body.address, own);
    if (!address.ok) {
      res
        .status(400)
        .json({ error: SPARK_ADDRESS_PROBLEMS[address.problem], problem: address.problem });
      return;
    }
    if (address.reach === 'custom' && body.trusted !== true) {
      res.status(400).json({ error: SPARK_ADDRESS_PROBLEMS.untrusted, problem: 'untrusted' });
      return;
    }
    let row: RemoteSparkRow;
    try {
      row = await addRemoteSpark(db, workspaceId, { name: body.name, hostname: address.hostname });
    } catch (error) {
      if (!(error instanceof RemoteSparkTakenError)) throw error;
      res.status(409).json({ error: error.message });
      return;
    }
    const saved = port ? await open(port, row, address.code) : row;
    res.status(201).json(await toSpark(saved));
  });

  router.patch('/remote-sparks/:id', async (req, res) => {
    const { name } = parseBody(renameRemoteSparkRequestSchema, req);
    const row = await renameRemoteSpark(db, workspaceId, paramId(req), name);
    if (!row) {
      res.status(404).json({ error: NO_SPARK });
      return;
    }
    res.json(await toSpark(row));
  });

  router.delete('/remote-sparks/:id', async (req, res) => {
    const id = paramId(req);
    if (!(await remoteSpark(db, workspaceId, id))) {
      res.status(404).json({ error: NO_SPARK });
      return;
    }
    await forgetSparkCookie(secrets, id);
    await deleteRemoteSpark(db, workspaceId, id);
    port?.post({ kind: 'remote-spark:close', id });
    await link.forget(id);
    res.status(204).end();
  });

  router.post('/remote-sparks/:id/open', async (req, res) => {
    const row = await remoteSpark(db, workspaceId, paramId(req));
    if (!row) {
      res.status(404).json({ error: NO_SPARK });
      return;
    }
    if (!port) {
      res.status(409).json({ error: NO_DESKTOP_APP });
      return;
    }
    res.json(await toSpark(await open(port, row, null)));
  });

  return router;
}
