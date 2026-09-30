export type NetworkRequest =
  | {
      type: 'start';
      nodes: { x: number; y: number; r: number }[];
      links: [number, number][];
      cx: number;
      cy: number;
      settle: boolean;
    }
  | { type: 'drag'; index: number; x: number; y: number }
  | { type: 'release'; index: number }
  | { type: 'stop' };

export interface NetworkUpdate {
  positions: Float32Array;
  done: boolean;
}
