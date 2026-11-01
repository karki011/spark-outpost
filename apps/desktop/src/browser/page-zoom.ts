import { browserOrigin, type BrowserProfile } from '@spark-outpost/contracts';
import type { SavedViewStore } from './view-saved.ts';

export interface PageZooms {
  of(url: string): number;
  set(url: string, zoom: number): void;
}

function zoomOrigin(url: string): string | null {
  const origin = browserOrigin(url);
  return origin && origin !== 'null' ? origin : null;
}

export function savedPageZooms(
  saved: SavedViewStore,
  profile: BrowserProfile,
  changed: () => void,
): PageZooms {
  return {
    of: (url) => {
      const origin = zoomOrigin(url);
      return (origin && saved.get(profile).zooms[origin]) || 1;
    },
    set: (url, zoom) => {
      const origin = zoomOrigin(url);
      if (!origin) return;
      saved.setZoom(profile, origin, zoom);
      changed();
    },
  };
}
