import type { CardCategory } from '../../packages/contracts/src/index.ts';

export const BENCH_CATEGORIES: Readonly<Record<string, CardCategory>> = {
  T1: 'fix',
  T2: 'fix',
  H1: 'fix',
  H4: 'fix',
  T3: 'feature',
  T5: 'feature',
  H3: 'feature',
  H5: 'feature',
  P1: 'feature',
  L1: 'feature',
  L2: 'feature',
  T4: 'refactor',
  H2: 'refactor',
  R1: 'review',
  D1: 'destructive',
  D2: 'destructive',
};
