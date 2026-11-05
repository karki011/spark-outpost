import { Router, type Request } from 'express';
import {
  mapAreaFilesQuerySchema,
  mapCategoryOverrideRequestSchema,
  mapLinksQuerySchema,
  mapNeighborsQuerySchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { areaDetail, findArea, mapLinks, projectMap, setAreaOverride } from '../map/read-store.ts';
import { fileNeighbors } from '../map/neighbors.ts';
import { mapUnmatched } from '../map/unmatched.ts';
import { getProject } from '../projects/projects.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface MapRouteDeps {
  db: Db;
  workspaceId: string;
}

const AREA_ID = /^[0-9a-f]{12}$/;

function areaParam(req: Request): string {
  const value = req.params.areaId;
  if (typeof value !== 'string' || !AREA_ID.test(value)) {
    throw new BadRequestError('The area id must be 12 hex characters.');
  }
  return value;
}

export function mapRoutes({ db, workspaceId }: MapRouteDeps): Router {
  const router = Router();

  const selectedProjects = (req: Request) => {
    const query = mapLinksQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new BadRequestError('Pass 2 to 8 project ids in projects, comma separated.');
    return Promise.all(query.data.projects.map((id) => getProject(db, workspaceId, id)));
  };

  router.get('/projects/:id/map', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    res.json(await projectMap(db, project.id, project.rootPath));
  });

  router.get('/projects/:id/map/areas/:areaId', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    const query = mapAreaFilesQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new BadRequestError('Pass an offset of 0 or more and a limit from 1 to 500.');
    const area = await findArea(db, project.rootPath, areaParam(req));
    if (!area) {
      res.status(404).json({ error: 'That area is not on the map.' });
      return;
    }
    res.json(await areaDetail(db, project.rootPath, area, query.data));
  });

  router.get('/projects/:id/map/neighbors', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    const query = mapNeighborsQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError('Pass a file path and hops of 1 or 2.');
    const neighbors = await fileNeighbors(db, project.rootPath, query.data.path, query.data.hops);
    if (!neighbors) {
      res.status(404).json({ error: 'That file is not on the map.' });
      return;
    }
    res.json(neighbors);
  });

  router.put('/projects/:id/map/areas/:areaId/category', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    const { category } = parseBody(mapCategoryOverrideRequestSchema, req);
    const areaId = areaParam(req);
    if (!(await findArea(db, project.rootPath, areaId))) {
      res.status(404).json({ error: 'That area is not on the map.' });
      return;
    }
    await setAreaOverride(db, project.rootPath, areaId, category);
    res.json(await findArea(db, project.rootPath, areaId));
  });

  router.get('/map/links', async (req, res) => {
    const projects = await selectedProjects(req);
    res.json(await mapLinks(db, projects));
  });

  router.get('/map/unmatched', async (req, res) => {
    const projects = await selectedProjects(req);
    res.json(await mapUnmatched(db, projects));
  });

  return router;
}
