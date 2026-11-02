import { ARTIFACT_OPEN_PARAM, ARTIFACT_OPEN_PATH, artifactOrigin } from '@spark-outpost/contracts';
import { targetsApi } from './api-token.ts';

let artifactPages: string | null = null;

export function allowArtifactFrames(apiPort: number): void {
  artifactPages = artifactOrigin(apiPort);
}

export function fromArtifactPage(url: string | null | undefined): boolean {
  return (
    artifactPages !== null && url !== null && url !== undefined && targetsApi(url, artifactPages)
  );
}

export const USER_ACTION_WINDOW_MS = 1000;

const WEB_ADDRESS = /^https?:\/\//i;
const ACTIVATING_KEYS = new Set(['Enter', ' ']);

export interface FrameNavigation {
  url: string;
  isMainFrame: boolean;
  frame?: { url: string } | null;
  preventDefault(): void;
}

export interface MouseAction {
  type: string;
}

export interface KeyAction {
  type: string;
  key: string;
}

export interface FrameGuardTarget {
  on(event: 'will-frame-navigate', listener: (details: FrameNavigation) => void): unknown;
  on(event: 'before-mouse-event', listener: (event: unknown, mouse: MouseAction) => void): unknown;
  on(event: 'before-input-event', listener: (event: unknown, input: KeyAction) => void): unknown;
}

export interface ArtifactLinks {
  confirm(address: string): Promise<boolean>;
  open(address: string): void;
  now(): number;
}

export function artifactLinkAddress(url: string): string | null {
  if (!WEB_ADDRESS.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function loadsArtifactPage(url: string): boolean {
  return fromArtifactPage(url) && new URL(url).pathname !== ARTIFACT_OPEN_PATH;
}

export function artifactLinkRequest(url: string): string | null {
  if (!fromArtifactPage(url)) return null;
  const parsed = new URL(url);
  if (parsed.pathname !== ARTIFACT_OPEN_PATH) return null;
  return artifactLinkAddress(parsed.searchParams.get(ARTIFACT_OPEN_PARAM) ?? '');
}

export function guardSubframes(contents: FrameGuardTarget, links: ArtifactLinks): void {
  let lastUserAction = Number.NEGATIVE_INFINITY;
  let asking = false;
  contents.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type === 'mouseUp') lastUserAction = links.now();
  });
  contents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && ACTIVATING_KEYS.has(input.key)) lastUserAction = links.now();
  });
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame || loadsArtifactPage(details.url)) return;
    details.preventDefault();
    if (!fromArtifactPage(details.frame?.url) || asking) return;
    const address = artifactLinkRequest(details.url);
    if (!address || links.now() - lastUserAction > USER_ACTION_WINDOW_MS) return;
    lastUserAction = Number.NEGATIVE_INFINITY;
    asking = true;
    void links
      .confirm(address)
      .then((confirmed) => {
        if (confirmed) links.open(address);
      })
      .finally(() => {
        asking = false;
      });
  });
}
