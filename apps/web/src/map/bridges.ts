import type { MapLinks } from '@spark-outpost/contracts';
import { areaKey, fileKey, type Scene } from './scene.ts';

export type MapLink = MapLinks['links'][number];
export type LinkKind = MapLink['kind'];

export const LINK_KINDS: readonly LinkKind[] = ['http', 'graphql', 'package', 'env'];

export const LINK_LABELS: Record<LinkKind, string> = {
  http: 'HTTP API',
  graphql: 'GraphQL',
  package: 'Shared packages',
  env: 'Env vars',
};

export interface Bridge {
  key: string;
  kind: LinkKind;
  from: string;
  to: string;
  fromArea: string;
  toArea: string;
  links: MapLink[];
  confidence: number;
  hash: number;
}

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

export function aggregateBridges(links: readonly MapLink[]): Bridge[] {
  const byPair = new Map<string, Bridge>();
  for (const link of links) {
    const from = fileKey(link.fromProjectId, link.fromPath);
    const to = fileKey(link.toProjectId, link.toPath);
    const key = `${link.kind}|${from}|${to}`;
    const bridge = byPair.get(key) ?? {
      key,
      kind: link.kind,
      from,
      to,
      fromArea: areaKey(link.fromProjectId, link.fromArea),
      toArea: areaKey(link.toProjectId, link.toArea),
      links: [],
      confidence: 0,
      hash: hashOf(key),
    };
    bridge.links.push(link);
    bridge.confidence = Math.max(bridge.confidence, link.confidence);
    byPair.set(key, bridge);
  }
  return [...byPair.values()].sort((a, b) => a.links.length - b.links.length);
}

export function bridgeAreaKeys(bridges: readonly Bridge[]): string[] {
  return [...new Set(bridges.flatMap((bridge) => [bridge.fromArea, bridge.toArea]))];
}

export function endpoint(scene: Scene, file: string, area: string): [number, number] | null {
  const index = scene.fileByKey.get(file);
  if (index !== undefined) return [scene.files[index]!.x, scene.files[index]!.y];
  const areaIndex = scene.areaByKey.get(area);
  if (areaIndex === undefined) return null;
  return [scene.areas[areaIndex]!.x, scene.areas[areaIndex]!.y];
}

export type Curve = [[number, number], [number, number], [number, number]];

export function bridgeCurve(
  a: [number, number],
  b: [number, number],
  hash: number,
  reach: number,
): Curve {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const side = my < -reach * 0.04 ? -1 : my > reach * 0.04 ? 1 : hash % 2 ? 1 : -1;
  const bend = reach * (0.26 + (hash % 7) * 0.055);
  return [a, [mx, my + side * bend], b];
}

export function curvePoint(curve: Curve, t: number): [number, number] {
  const [a, m, b] = curve;
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * m[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * m[1] + t * t * b[1],
  ];
}

const MAX_HOPS = 3;

function bestNext(
  candidates: readonly number[],
  avoid: ReadonlySet<number>,
  prefer: (i: number) => number,
) {
  let best = -1;
  for (const candidate of candidates) {
    if (avoid.has(candidate)) continue;
    if (best < 0 || prefer(candidate) > prefer(best)) best = candidate;
  }
  return best;
}

export function likelyPath(scene: Scene, bridge: Bridge): number[] {
  const from = scene.fileByKey.get(bridge.from);
  const to = scene.fileByKey.get(bridge.to);
  if (from === undefined || to === undefined) return [];
  const chain = [from, to];
  const used = new Set(chain);
  const sameArea = (i: number, j: number) =>
    scene.files[i]!.areaIndex === scene.files[j]!.areaIndex;
  const caller = bestNext(
    scene.ins[from]!,
    used,
    (i) =>
      (scene.files[i]!.kind === 'ui' ? 1000 : 0) +
      (sameArea(i, from) ? 100 : 0) +
      scene.files[i]!.importance,
  );
  if (caller >= 0 && scene.files[caller]!.kind === 'ui') {
    chain.unshift(caller);
    used.add(caller);
  }
  let current = to;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const next = bestNext(
      scene.outs[current]!.filter((i) => scene.files[i]!.projectId === scene.files[to]!.projectId),
      used,
      (i) => (scene.files[i]!.kind === 'data' ? 1000 : 0) + scene.files[i]!.importance,
    );
    if (next < 0) break;
    chain.push(next);
    used.add(next);
    current = next;
    if (scene.files[next]!.kind === 'data') break;
  }
  return chain;
}
