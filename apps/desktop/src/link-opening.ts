import type { BrowserLinksIn } from '@spark-outpost/contracts';
import { linkTarget, type LinkIntent, type LinkTarget } from './link-target.ts';

export interface LinkOpening {
  linksIn(): BrowserLinksIn;
  openInSpark(url: string): boolean;
}

let opening: LinkOpening | null = null;

export function setLinkOpening(next: LinkOpening | null): void {
  opening = next;
}

export function focusingLinks(links: LinkOpening, focus: () => void): LinkOpening {
  return {
    linksIn: () => links.linksIn(),
    openInSpark(url) {
      if (!links.openInSpark(url)) return false;
      focus();
      return true;
    },
  };
}

export function routeLink(url: string, origin: string, intent: LinkIntent): LinkTarget {
  const linksIn = opening?.linksIn() ?? 'browser';
  return linkTarget(url, origin, { linksIn, intent });
}

export function openInSpark(url: string): boolean {
  return opening?.openInSpark(url) ?? false;
}

export function otherLinkTarget(url: string, origin: string): 'spark' | 'browser' | null {
  const follow = routeLink(url, origin, 'follow');
  const other = routeLink(url, origin, 'other');
  if (other === follow) return null;
  return other === 'spark' || other === 'browser' ? other : null;
}
