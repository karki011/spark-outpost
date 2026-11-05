import type { MapArea, MapCategory, MapFileKind } from '../../packages/contracts/src/map.ts';
import { hex12, kindCounts, MapFixture, status, type FixtureFile } from './map-fixture.ts';

interface AreaSpec {
  root: string;
  name: string;
  category: MapCategory;
  files: number;
  layer: number;
}

const APPS = [
  'shell',
  'admin-portal',
  'customer-portal',
  'partner-portal',
  'checkout',
  'docs-site',
];
const APP_PARTS = ['routes', 'layout', 'pages', 'state', 'e2e', 'config'];
const SHARED = {
  ui: [
    'buttons',
    'forms',
    'tables',
    'layout',
    'dialogs',
    'icons',
    'charts',
    'theming',
    'typography',
    'navigation',
    'cards',
    'menus',
    'toasts',
    'avatars',
    'tabs',
    'date-picker',
    'upload',
    'stepper',
    'tooltips',
    'badges',
  ],
  'data-access': [
    'http',
    'cache',
    'auth-client',
    'feature-flags',
    'analytics',
    'websocket',
    'storage',
    'graphql',
    'errors',
    'pagination',
    'offline',
    'telemetry',
  ],
  util: [
    'dates',
    'money',
    'strings',
    'validation',
    'i18n',
    'arrays',
    'testing',
    'logging',
    'env',
    'ids',
    'urls',
    'files',
  ],
};
const CORE = ['auth', 'session', 'permissions', 'config', 'tenancy'];
const DOMAINS = [
  'orders',
  'billing',
  'catalog',
  'inventory',
  'customers',
  'reports',
  'notifications',
  'search',
  'shipping',
  'returns',
  'loyalty',
  'pricing',
  'payments',
  'reviews',
  'promotions',
  'accounts',
  'support',
  'subscriptions',
  'audit',
  'media',
];
const DOMAIN_PARTS = [
  'feature-list',
  'feature-detail',
  'feature-edit',
  'data-access',
  'ui',
  'util',
  'state',
  'api-types',
  'e2e',
];

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function specs(): AreaSpec[] {
  const random = rng(7);
  const size = (low: number, high: number) => low + Math.floor(random() * (high - low));
  const areas: AreaSpec[] = [];
  for (const app of APPS) {
    for (const part of APP_PARTS) {
      areas.push({
        root: `apps/${app}/src/app/${part}`,
        name: `${app} ${part}`,
        category: 'feature',
        files: size(4, 18),
        layer: 0,
      });
    }
  }
  for (const domain of DOMAINS) {
    for (const part of DOMAIN_PARTS) {
      const shared = part === 'data-access' || part === 'api-types' || part === 'util';
      areas.push({
        root: `libs/${domain}/${part}`,
        name: `${domain} ${part.replace('feature-', '')}`,
        category: shared ? 'shared' : 'feature',
        files: shared ? size(10, 22) : size(8, 16),
        layer: shared ? 2 : 1,
      });
    }
  }
  for (const [kind, names] of Object.entries(SHARED)) {
    for (const name of names) {
      areas.push({
        root: `libs/shared/${kind}/${name}`,
        name: `${name}`,
        category: 'shared',
        files: size(28, 68),
        layer: 3,
      });
    }
  }
  for (const name of CORE) {
    areas.push({
      root: `libs/core/${name}`,
      name: `core ${name}`,
      category: 'core',
      files: size(18, 30),
      layer: 4,
    });
  }
  return areas;
}

const EXT: Record<MapFileKind, string> = {
  ui: '.component.tsx',
  api: '.service.ts',
  data: '.store.ts',
  test: '.spec.ts',
  config: '.config.ts',
  other: '.md',
};
const KIND_ORDER: MapFileKind[] = ['ui', 'api', 'data', 'test', 'config', 'other'];
const WORDS = [
  'index',
  'model',
  'view',
  'list',
  'item',
  'panel',
  'hooks',
  'mapper',
  'guard',
  'effects',
  'selectors',
  'client',
  'schema',
  'utils',
  'types',
  'facade',
  'resolver',
  'form',
  'table',
  'routes',
];
const DAY = 86_400_000;

export function nxFixture(projectId: string): MapFixture {
  const random = rng(42);
  const areaSpecs = specs();
  const files = new Map<string, FixtureFile[]>();
  const byArea: FixtureFile[][] = [];
  const edges: [string, string][] = [];
  const now = Date.now();
  areaSpecs.forEach((spec) => {
    const list = Array.from({ length: spec.files }, (_, i): FixtureFile => {
      const kind =
        spec.layer >= 3 && i % 3 === 0 ? 'ui' : KIND_ORDER[Math.floor(random() * random() * 6)]!;
      const folder = i < 3 ? '' : `${['lib', 'components', 'services', 'state'][i % 4]}/`;
      const importance = Math.min(1, (spec.layer + 1) * 0.12 * Math.pow(0.86, i) + random() * 0.05);
      return {
        path: `${spec.root}/src/${folder}${WORDS[i % WORDS.length]}-${i}${EXT[kind]}`,
        kind,
        lastChangedAt:
          random() < 0.8 ? new Date(now - Math.floor(random() * 60) * DAY).toISOString() : null,
        changeCount: 1 + Math.floor(random() * 30),
        authorCount: 1 + Math.floor(random() * 6),
        x: Math.cos(i * 2.4) * Math.sqrt(i + 1) * 7,
        y: Math.sin(i * 2.4) * Math.sqrt(i + 1) * 7,
        importance,
        fanIn: 0,
        fanOut: 0,
        reasons: [],
        lines: 30 + Math.floor(random() * 300),
      };
    });
    byArea.push(list);
  });
  const layers = [0, 1, 2, 3, 4].map((layer) =>
    areaSpecs.flatMap((spec, index) => (spec.layer === layer ? [index] : [])),
  );
  byArea.forEach((list, index) => {
    const spec = areaSpecs[index]!;
    list.forEach((file, i) => {
      if (i > 0) edges.push([file.path, list[Math.floor(random() * i)]!.path]);
      const deeper = layers.slice(spec.layer + 1).flat();
      if (deeper.length === 0 || random() < 0.35) return;
      const pick = (pool: number[]) => pool[Math.floor(random() * random() * pool.length)]!;
      const target = byArea[pick(deeper)]!;
      edges.push([file.path, target[Math.floor(random() * Math.min(3, target.length))]!.path]);
    });
  });
  const all = new Map(byArea.flat().map((file) => [file.path, file]));
  const unique = [...new Map(edges.map((edge) => [edge.join('>'), edge])).values()];
  for (const [from, to] of unique) {
    all.get(from)!.fanOut += 1;
    all.get(to)!.fanIn += 1;
  }
  for (const file of all.values()) file.reasons = [`imported by ${file.fanIn}`];
  const areaOf = new Map<string, string>();
  const areas: MapArea[] = areaSpecs.map((spec, index) => {
    const id = hex12(`${projectId}:${spec.root}`);
    const list = [...byArea[index]!].sort((a, b) => b.importance - a.importance);
    files.set(id, list);
    for (const file of list) areaOf.set(file.path, id);
    const angle = index * 2.39996;
    const radius = 90 * Math.sqrt(index + 1);
    return {
      id,
      root: spec.root,
      source: 'folder',
      package: '',
      reason: 'Grouped by folder',
      name: spec.name,
      description: `${spec.name} in the workspace`,
      category: spec.category,
      categorySource: index % 7 === 0 ? 'rules' : 'jev',
      kind: 'domain',
      confidence: index % 7 === 0 ? null : 0.6 + ((index * 17) % 39) / 100,
      fileCount: list.length,
      lineCount: list.reduce((sum, file) => sum + file.lines, 0),
      fanIn: 0,
      fanOut: 0,
      importance: list[0]!.importance,
      topFiles: list.slice(0, 5).map((file) => file.path),
      kindCounts: kindCounts(list),
      lastChangedAt:
        list
          .map((file) => file.lastChangedAt ?? '')
          .sort()
          .at(-1) || null,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      radius: Math.sqrt(list.length) * 7 + 14,
    };
  });
  const weights = new Map<string, number>();
  for (const [from, to] of unique) {
    const a = areaOf.get(from)!;
    const b = areaOf.get(to)!;
    if (a !== b) weights.set(`${a}>${b}`, (weights.get(`${a}>${b}`) ?? 0) + 1);
  }
  const fixture = new MapFixture();
  const fileCount = areas.reduce((sum, area) => sum + area.fileCount, 0);
  fixture.add({
    projectId,
    status: status(fileCount, areas.length, unique.length),
    areas,
    areaEdges: [...weights].map(([key, weight]) => {
      const [from, to] = key.split('>') as [string, string];
      return { from, to, weight };
    }),
    files,
    edges: unique,
  });
  fixture.changedPaths = [byArea[40]![0]!.path, byArea[41]![1]!.path, byArea[200]![0]!.path];
  return fixture;
}
