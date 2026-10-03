import { targetsApi } from './api-token.ts';

export type LinkTarget = 'viewer' | 'browser' | 'none';

const OUTSIDE_LINK = /^(https?:\/\/|mailto:)/;

export function linkTarget(url: string, origin: string): LinkTarget {
  if (targetsApi(url, origin)) return 'viewer';
  return OUTSIDE_LINK.test(url) ? 'browser' : 'none';
}
