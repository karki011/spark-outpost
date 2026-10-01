import { useEffect, useRef, useSyncExternalStore } from 'react';
import { guideLink, parseGuideLink, type GuideLink } from '@spark-outpost/contracts';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function docHash(): string | null {
  return parseGuideLink(window.location.hash) ? window.location.hash : null;
}

export function isDocLinkOpen(): boolean {
  return docHash() !== null;
}

export function useDocRoute(): GuideLink | null {
  const hash = useSyncExternalStore(subscribe, docHash);
  return hash ? parseGuideLink(hash) : null;
}

export function useDocLinks(onOpen: () => void): void {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(
    () =>
      subscribe(() => {
        if (docHash()) latest.current();
      }),
    [],
  );
}

export function openDoc(slug: string, anchor?: string | null): void {
  window.location.hash = guideLink(slug, anchor);
}

export function leaveDocs(): void {
  if (!docHash()) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
