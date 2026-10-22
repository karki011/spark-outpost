import { artifactOrigin } from '@spark-outpost/contracts';
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

export interface FrameNavigation {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

export interface FrameGuardTarget {
  on(event: 'will-frame-navigate', listener: (details: FrameNavigation) => void): unknown;
}

export function guardSubframes(contents: FrameGuardTarget): void {
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    if (!fromArtifactPage(details.url)) details.preventDefault();
  });
}
