import { contrast, over, rgbaToOklch, toHex, withAlpha, type Rgba } from './color.ts';
import { ALLOWLIST, HUE_PAIRS, PAIRS, THRESHOLDS, type Pair, type PairKind } from './pairs.ts';
import { resolver, type Tokens } from './theme.ts';

export type Status = 'pass' | 'fail' | 'exempt';

export type PairResult = {
  id: string;
  group: string;
  label: string;
  kind: PairKind;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  status: Status;
  reason?: string;
};

export type HueResult = {
  id: string;
  label: string;
  degrees: number;
  required: number;
  status: Status;
};

const OPAQUE_WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

function composite(layers: Rgba[]): Rgba {
  return layers.reduce((below, layer) => over(layer, below), OPAQUE_WHITE);
}

function statusOf(pair: Pair, ratio: number, required: number): Status {
  if (pair.id in ALLOWLIST) return 'exempt';
  if (pair.kind === 'disabled' || pair.kind === 'decorative') return 'fail';
  return ratio + 1e-9 >= required ? 'pass' : 'fail';
}

export function evaluatePair(pair: Pair, resolve: (expr: string) => Rgba): PairResult {
  const background = composite(pair.bg.map(resolve));
  const foreground = over(withAlpha(resolve(pair.fg), pair.fgAlpha ?? 1), background);
  const ratio = contrast(foreground, background);
  const required = THRESHOLDS[pair.kind];
  const status = statusOf(pair, ratio, required);
  return {
    id: pair.id,
    group: pair.group,
    label: pair.label,
    kind: pair.kind,
    fg: toHex(foreground),
    bg: toHex(background),
    ratio,
    required,
    status,
    ...(pair.id in ALLOWLIST ? { reason: ALLOWLIST[pair.id] } : {}),
  };
}

function hueDistance(first: Rgba, second: Rgba): number {
  const delta = Math.abs(rgbaToOklch(first).h - rgbaToOklch(second).h);
  return Math.min(delta, 360 - delta);
}

export function auditTokens(tokens: Tokens): { pairs: PairResult[]; hues: HueResult[] } {
  const resolve = resolver(tokens);
  const pairs = PAIRS.map((pair) => evaluatePair(pair, resolve));
  const hues = HUE_PAIRS.map((hue) => {
    const degrees = hueDistance(resolve(hue.first), resolve(hue.second));
    const status: Status = degrees >= hue.minDegrees ? 'pass' : 'fail';
    return { id: hue.id, label: hue.label, degrees, required: hue.minDegrees, status };
  });
  return { pairs, hues };
}
