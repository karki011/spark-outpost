import { remoteSparkOrigin } from '@spark-outpost/contracts';

export type RemoteNavigation = 'allow' | 'external' | 'refuse';

const WEB_SCHEMES = new Set(['http:', 'https:']);

export function remoteNavigation(value: string, hostname: string): RemoteNavigation {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'refuse';
  }
  if (!WEB_SCHEMES.has(url.protocol)) return 'refuse';
  if (url.username !== '' || url.password !== '') return 'refuse';
  return url.origin === remoteSparkOrigin(hostname) ? 'allow' : 'external';
}

interface Preventable {
  preventDefault(): void;
}

export interface GuardedContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: Preventable, url: string) => void): unknown;
  on(
    event: 'will-redirect',
    listener: (event: Preventable, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): unknown;
  on(event: 'will-prevent-unload', listener: (event: Preventable) => void): unknown;
}

export function guardRemoteNavigation(
  contents: GuardedContents,
  hostname: string,
  openExternal: (url: string) => void,
): void {
  const openElsewhere = (url: string) => {
    if (remoteNavigation(url, hostname) === 'external') openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    openElsewhere(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (remoteNavigation(url, hostname) === 'allow') return;
    event.preventDefault();
    openElsewhere(url);
  });
  contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && remoteNavigation(url, hostname) !== 'allow') event.preventDefault();
  });
  contents.on('will-prevent-unload', (event) => event.preventDefault());
}
