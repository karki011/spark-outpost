import {
  currentProviderRoute,
  leaveProviderRoute,
  parseProviderRoute,
  providerRouteHash,
} from '../providers/provider-route.ts';
import { SETTINGS_SECTION_IDS, sectionAvailable, type SettingsSection } from './section-ids.ts';

const PREFIX = '#/settings/';

export function parseSettingsRoute(hash: string): SettingsSection | null {
  if (parseProviderRoute(hash)) return 'ai';
  if (!hash.startsWith(PREFIX)) return null;
  const id = hash.slice(PREFIX.length).replace(/\/$/, '');
  return (
    SETTINGS_SECTION_IDS.find((section) => section === id && sectionAvailable(section)) ?? null
  );
}

export function settingsRouteHash(section: SettingsSection): string {
  return section === 'ai' ? providerRouteHash(null) : `${PREFIX}${section}`;
}

export function routeFor(section: SettingsSection, hash: string): string {
  return section === 'ai' && parseProviderRoute(hash) ? hash : settingsRouteHash(section);
}

export function leaveSettingsRoute(): void {
  if (currentProviderRoute()) {
    leaveProviderRoute();
    return;
  }
  if (!parseSettingsRoute(window.location.hash)) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
