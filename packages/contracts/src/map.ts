import { z } from 'zod';

export const MAP_CATEGORIES = ['core', 'shared', 'feature'] as const;
export const mapCategorySchema = z.enum(MAP_CATEGORIES);
export type MapCategory = z.infer<typeof mapCategorySchema>;

export const MAP_KINDS = [
  'ui',
  'api',
  'data',
  'domain',
  'auth',
  'integration',
  'infra',
  'tooling',
  'config',
  'tests',
  'docs',
] as const;
export const mapKindSchema = z.enum(MAP_KINDS);
export type MapKind = z.infer<typeof mapKindSchema>;

export const MAP_FILE_KINDS = ['ui', 'api', 'data', 'test', 'config', 'other'] as const;
export const mapFileKindSchema = z.enum(MAP_FILE_KINDS);
export type MapFileKind = z.infer<typeof mapFileKindSchema>;

export const mapBuildStatusSchema = z.enum(['queued', 'building', 'paused', 'ready', 'failed']);
export const mapPhaseSchema = z.enum(['index', 'graph', 'labels', 'links', 'done']);

export const mapStatusSchema = z.object({
  mapId: z.uuid(),
  status: mapBuildStatusSchema,
  phase: mapPhaseSchema,
  progress: z.object({ done: z.number().int(), total: z.number().int() }),
  rulesVersion: z.string(),
  builtCommit: z.string().nullable(),
  builtAt: z.string().nullable(),
  fileCount: z.number().int(),
  areaCount: z.number().int(),
  edgeCount: z.number().int(),
  timings: z.record(z.string(), z.number()),
  jevAreas: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type MapStatus = z.infer<typeof mapStatusSchema>;

export const mapLabelSourceSchema = z.enum(['override', 'jev', 'rules']);

export const mapAreaSchema = z.object({
  id: z.string(),
  root: z.string(),
  source: z.enum(['package', 'folder', 'merged', 'root']),
  package: z.string(),
  reason: z.string(),
  name: z.string(),
  description: z.string(),
  category: mapCategorySchema,
  categorySource: mapLabelSourceSchema,
  kind: mapKindSchema,
  confidence: z.number().nullable(),
  fileCount: z.number().int(),
  lineCount: z.number().int(),
  fanIn: z.number().int(),
  fanOut: z.number().int(),
  importance: z.number(),
  topFiles: z.array(z.string()),
  kindCounts: z.record(mapFileKindSchema, z.number().int()),
  lastChangedAt: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  radius: z.number(),
});
export type MapArea = z.infer<typeof mapAreaSchema>;

export const mapAreaEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  weight: z.number().int(),
});

export const projectMapSchema = z.object({
  projectId: z.uuid(),
  status: mapStatusSchema.nullable(),
  areas: z.array(mapAreaSchema),
  areaEdges: z.array(mapAreaEdgeSchema),
});
export type ProjectMap = z.infer<typeof projectMapSchema>;

export const mapFileSchema = z.object({
  path: z.string(),
  areaId: z.string(),
  language: z.string(),
  kind: mapFileKindSchema,
  lines: z.number().int(),
  fanIn: z.number().int(),
  fanOut: z.number().int(),
  importance: z.number(),
  reasons: z.array(z.string()),
  lastChangedAt: z.string().nullable(),
  changeCount: z.number().int(),
  authorCount: z.number().int(),
  x: z.number(),
  y: z.number(),
});

export const mapFileEdgeSchema = z.object({ from: z.string(), to: z.string() });

export const MAP_AREA_FILES_LIMIT = 500;

export const mapAreaFilesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAP_AREA_FILES_LIMIT).default(200),
});

export const mapAreaDetailSchema = z.object({
  area: mapAreaSchema,
  files: z.array(mapFileSchema),
  edges: z.array(mapFileEdgeSchema),
  totalFiles: z.number().int(),
  nextOffset: z.number().int().nullable(),
});
export type MapAreaDetail = z.infer<typeof mapAreaDetailSchema>;
export type MapFile = z.infer<typeof mapFileSchema>;

export const MAP_NEIGHBORS_MAX = 200;

export const mapNeighborsQuerySchema = z.object({
  path: z.string().min(1).max(1024),
  hops: z.coerce.number().int().min(1).max(2).default(1),
});

export const mapNeighborSchema = z.object({
  path: z.string(),
  areaId: z.string(),
  kind: mapFileKindSchema,
  importance: z.number(),
  fanIn: z.number().int(),
  hop: z.number().int().min(1).max(2),
});
export type MapNeighbor = z.infer<typeof mapNeighborSchema>;

export const mapNeighborsSchema = z.object({
  path: z.string(),
  areaId: z.string(),
  hops: z.number().int(),
  imports: z.array(mapNeighborSchema),
  importedBy: z.array(mapNeighborSchema),
  importsTotal: z.number().int(),
  importedByTotal: z.number().int(),
  impact: z.object({
    direct: z.number().int(),
    total: z.number().int(),
    areas: z.number().int(),
    coreAreas: z.array(z.object({ id: z.string(), name: z.string(), files: z.number().int() })),
  }),
});
export type MapNeighbors = z.infer<typeof mapNeighborsSchema>;

export const MAP_LOCATE_MAX_PATHS = 50;

export const mapLocateQuerySchema = z.object({
  path: z.preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(z.string().min(1).max(1024)).min(1).max(MAP_LOCATE_MAX_PATHS),
  ),
});

export const mapLocateSchema = z.object({
  located: z.array(z.object({ path: z.string(), areaId: z.string().nullable() })),
});
export type MapLocate = z.infer<typeof mapLocateSchema>;

export const mapCategoryOverrideRequestSchema = z.object({
  category: mapCategorySchema.nullable(),
});

export const MAP_LINK_PROJECTS_MAX = 8;

export const mapLinksQuerySchema = z.object({
  projects: z
    .string()
    .transform((value) => [...new Set(value.split(',').filter((id) => id.length > 0))])
    .pipe(z.array(z.uuid()).min(2).max(MAP_LINK_PROJECTS_MAX)),
});

export const mapLinkKindSchema = z.enum(['http', 'graphql', 'package', 'env']);

export const mapLinkSchema = z.object({
  kind: mapLinkKindSchema,
  label: z.string(),
  fromProjectId: z.uuid(),
  toProjectId: z.uuid(),
  fromPath: z.string(),
  toPath: z.string(),
  fromArea: z.string(),
  toArea: z.string(),
  fromLine: z.number().int().nullable(),
  toLine: z.number().int().nullable(),
  confidence: z.number(),
  source: z.enum(['rules', 'jev']),
});

export const mapAreaLinkSchema = z.object({
  fromProjectId: z.uuid(),
  fromArea: z.string(),
  toProjectId: z.uuid(),
  toArea: z.string(),
  kinds: z.array(mapLinkKindSchema),
  count: z.number().int(),
  confidence: z.number(),
});

export const mapLinksSchema = z.object({
  projects: z.array(
    z.object({
      projectId: z.uuid(),
      mapId: z.uuid().nullable(),
      status: mapBuildStatusSchema.nullable(),
    }),
  ),
  links: z.array(mapLinkSchema),
  areaLinks: z.array(mapAreaLinkSchema),
});
export type MapLinks = z.infer<typeof mapLinksSchema>;

export const MAP_UNMATCHED_MAX = 200;

export const mapUnmatchedEndpointSchema = z.object({
  projectId: z.uuid(),
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().nullable(),
  confirmedBy: z.enum(['jev']).nullable(),
});
export type MapUnmatchedEndpoint = z.infer<typeof mapUnmatchedEndpointSchema>;

export const mapUnmatchedSchema = z.object({
  routes: z.array(mapUnmatchedEndpointSchema),
  calls: z.array(mapUnmatchedEndpointSchema),
  routeTotal: z.number().int(),
  callTotal: z.number().int(),
  pending: z.boolean(),
});
export type MapUnmatched = z.infer<typeof mapUnmatchedSchema>;

export const coreImpactSchema = z.object({
  areas: z.array(z.object({ id: z.string(), name: z.string(), files: z.number().int() })),
  keyFiles: z.array(z.string()),
});
export type CoreImpact = z.infer<typeof coreImpactSchema>;
