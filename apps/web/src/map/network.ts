import type { Box } from './camera.ts';
import type { NetworkRequest, NetworkUpdate } from './network-messages.ts';
import type { Scene } from './scene.ts';

export interface Network {
  areaIndex: number;
  files: number[];
  slot: Map<number, number>;
  links: [number, number][];
  radius: Float32Array;
  positions: Float32Array | null;
  settled: boolean;
}

const SPREAD = 2.2;

export function networkFor(scene: Scene, areaIndex: number): Network {
  const area = scene.areas[areaIndex]!;
  const files = [...area.files];
  const slot = new Map(files.map((file, position) => [file, position]));
  const links: [number, number][] = [];
  for (const file of files) {
    for (const target of scene.outs[file]!) {
      const other = slot.get(target);
      if (other !== undefined) links.push([slot.get(file)!, other]);
    }
  }
  const top = files.reduce((max, file) => Math.max(max, scene.files[file]!.importance), 0) || 1;
  const radius = new Float32Array(
    files.map((file) => 3.5 + 12 * Math.sqrt(scene.files[file]!.importance / top)),
  );
  return { areaIndex, files, slot, links, radius, positions: null, settled: false };
}

export function remapNetwork(network: Network, from: Scene, to: Scene): Network | null {
  const areaIndex = to.areaByKey.get(from.areas[network.areaIndex]!.key);
  const files = network.files.map((file) => to.fileByKey.get(from.files[file]!.key));
  if (areaIndex === undefined || files.some((file) => file === undefined)) return null;
  const mapped = files as number[];
  return {
    ...network,
    areaIndex,
    files: mapped,
    slot: new Map(mapped.map((file, slot) => [file, slot])),
  };
}

export function networkBounds(network: Network): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  network.files.forEach((_, slot) => {
    const x = network.positions![slot * 2]!;
    const y = network.positions![slot * 2 + 1]!;
    const r = network.radius[slot]!;
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    y0 = Math.min(y0, y - r);
    y1 = Math.max(y1, y + r);
  });
  const px = (x1 - x0) * 0.08 + 30;
  const py = (y1 - y0) * 0.12 + 40;
  return [x0 - px, y0 - py, x1 + px, y1 + py];
}

export class NetworkRunner {
  private worker: Worker | null = null;

  constructor(private readonly onUpdate: (update: NetworkUpdate) => void) {}

  start(scene: Scene, network: Network, settle: boolean): void {
    this.stop();
    const area = scene.areas[network.areaIndex]!;
    const worker = new Worker(new URL('./network-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<NetworkUpdate>) => this.onUpdate(event.data);
    this.worker = worker;
    this.send({
      type: 'start',
      nodes: network.files.map((file, index) => {
        const f = scene.files[file]!;
        return {
          x: area.x + (f.x - area.x) * SPREAD,
          y: area.y + (f.y - area.y) * SPREAD,
          r: network.radius[index]!,
        };
      }),
      links: network.links,
      cx: area.x,
      cy: area.y,
      settle,
    });
  }

  drag(index: number, x: number, y: number): void {
    this.send({ type: 'drag', index, x, y });
  }

  release(index: number): void {
    this.send({ type: 'release', index });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private send(request: NetworkRequest): void {
    this.worker?.postMessage(request);
  }
}
