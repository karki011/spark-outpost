import type { RequestHandler, Router } from 'express';
import type { Db } from '../persistence/db.ts';
import { remoteGateway } from './gateway.ts';
import { Pairings } from './pairing.ts';
import { remoteRoutes } from './routes.ts';
import { DeviceStreams } from './streams.ts';

export interface RemoteAccessDeps {
  db: Db;
  workspaceId: string;
  port: number;
  webRoot?: string | undefined;
}

export interface RemoteAccessParts {
  guard(local: readonly RequestHandler[]): RequestHandler;
  bodyGuard: RequestHandler;
  routes: Router;
}

export function remoteAccessParts(deps: RemoteAccessDeps): RemoteAccessParts {
  const streams = new DeviceStreams();
  const gateway = remoteGateway({ ...deps, streams });
  return {
    guard: gateway.guard,
    bodyGuard: gateway.bodyGuard,
    routes: remoteRoutes({
      db: deps.db,
      workspaceId: deps.workspaceId,
      pairings: new Pairings(),
      streams,
    }),
  };
}
