import {
  MAP_AREA_FILES_LIMIT,
  mapAreaDetailSchema,
  mapAreaSchema,
  mapLinksSchema,
  mapNeighborsSchema,
  mapUnmatchedSchema,
  projectMapSchema,
  type MapArea,
  type MapAreaDetail,
  type MapCategory,
  type MapLinks,
  type MapNeighbors,
  type MapUnmatched,
  type ProjectMap,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const FIRST_PAGE = 120;

export const mapKeys = {
  all: ['map'] as const,
  project: (projectId: string) => ['map', 'project', projectId] as const,
  area: (projectId: string, areaId: string, limit: number, version: string) =>
    ['map', 'area', projectId, areaId, limit, version] as const,
  links: (projectIds: readonly string[]) => ['map', 'links', ...projectIds] as const,
  unmatched: (projectIds: readonly string[]) => ['map', 'unmatched', ...projectIds] as const,
  neighbors: (projectId: string, path: string, hops: number, version: string) =>
    ['map', 'neighbors', projectId, path, hops, version] as const,
};

async function allPages(projectId: string, areaId: string): Promise<MapAreaDetail> {
  const first = await mapApi.page(projectId, areaId, 0, MAP_AREA_FILES_LIMIT);
  let detail = first;
  while (detail.nextOffset !== null) {
    const next = await mapApi.page(projectId, areaId, detail.nextOffset, MAP_AREA_FILES_LIMIT);
    detail = {
      ...next,
      files: [...detail.files, ...next.files],
      edges: [...detail.edges, ...next.edges],
    };
  }
  return detail;
}

export const mapApi = {
  project: (projectId: string): Promise<ProjectMap> =>
    request(projectMapSchema, `/projects/${projectId}/map`),
  page: (
    projectId: string,
    areaId: string,
    offset: number,
    limit: number,
  ): Promise<MapAreaDetail> =>
    request(
      mapAreaDetailSchema,
      `/projects/${projectId}/map/areas/${areaId}?offset=${offset}&limit=${limit}`,
    ),
  area: (projectId: string, areaId: string, limit: number): Promise<MapAreaDetail> =>
    limit <= FIRST_PAGE ? mapApi.page(projectId, areaId, 0, limit) : allPages(projectId, areaId),
  setCategory: (
    projectId: string,
    areaId: string,
    category: MapCategory | null,
  ): Promise<MapArea> =>
    request(mapAreaSchema, `/projects/${projectId}/map/areas/${areaId}/category`, {
      method: 'PUT',
      body: JSON.stringify({ category }),
    }),
  neighbors: (projectId: string, path: string, hops: number): Promise<MapNeighbors> =>
    request(
      mapNeighborsSchema,
      `/projects/${projectId}/map/neighbors?path=${encodeURIComponent(path)}&hops=${hops}`,
    ),
  links: (projectIds: readonly string[]): Promise<MapLinks> =>
    request(mapLinksSchema, `/map/links?projects=${projectIds.join(',')}`),
  unmatched: (projectIds: readonly string[]): Promise<MapUnmatched> =>
    request(mapUnmatchedSchema, `/map/unmatched?projects=${projectIds.join(',')}`),
};
