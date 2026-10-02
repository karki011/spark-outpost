import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Emit, UpdateDriver } from './update-controller.ts';

export type PreviewMode = 'available' | 'ready' | 'flow' | 'flow-busy';

const MODES: readonly PreviewMode[] = ['available', 'ready', 'flow', 'flow-busy'];
const FALLBACK_VERSION = '9.9.9-preview';
export const FLOW_CHECK_DELAY_MS = 3_000;
export const INSTALL_PAUSE_MS = 1_500;

export const DOWNLOAD_STEPS: readonly (readonly [waitMs: number, percent: number])[] = [
  [400, 3],
  [600, 9],
  [300, 14],
  [900, 22],
  [500, 31],
  [200, 34],
  [1_100, 47],
  [400, 55],
  [700, 63],
  [300, 68],
  [900, 79],
  [500, 86],
  [400, 92],
  [600, 97],
  [200, 100],
];

export function previewMode(value: string | undefined): PreviewMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

function isFlow(mode: PreviewMode): boolean {
  return mode === 'flow' || mode === 'flow-busy';
}

export function previewCheckDelay(mode: PreviewMode): number {
  return isFlow(mode) ? FLOW_CHECK_DELAY_MS : 0;
}

export function previewAutoDownload(mode: PreviewMode): boolean {
  return mode === 'ready';
}

export function nextPreviewVersion(current: string): string {
  const prerelease = /^(\d+\.\d+\.\d+-[0-9A-Za-z-]+)\.(\d+)$/.exec(current);
  if (prerelease) return `${prerelease[1]}.${Number(prerelease[2]) + 1}`;
  const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (stable) return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}`;
  return FALLBACK_VERSION;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PreviewDriverOptions {
  mode: PreviewMode;
  version: string;
  emit: Emit;
  relaunch: () => Promise<void>;
  quit: () => void;
}

export function previewDriver(options: PreviewDriverOptions): UpdateDriver {
  return {
    configure: () => undefined,
    async check() {
      await wait(previewCheckDelay(options.mode));
      return options.version;
    },
    async download() {
      for (const [waitMs, percent] of DOWNLOAD_STEPS) {
        await wait(waitMs);
        options.emit({ type: 'progress', percent });
      }
      options.emit({ type: 'downloaded', version: options.version });
    },
    install(relaunch) {
      if (!relaunch) {
        options.quit();
        return;
      }
      setTimeout(() => void options.relaunch(), INSTALL_PAUSE_MS);
    },
  };
}

export function previewActiveRuns(
  mode: PreviewMode,
  real: () => Promise<number | null>,
): () => Promise<number | null> {
  let pretendBusy = mode === 'flow-busy';
  return async () => {
    if (!pretendBusy) return real();
    pretendBusy = false;
    return 1;
  };
}

export function previewMarkerFile(userData: string): string {
  return path.join(userData, 'update-preview.json');
}

export async function writePreviewMarker(file: string, version: string): Promise<void> {
  await writeFile(file, JSON.stringify({ version }));
}

function markerVersion(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' && version.length <= 64 ? version : null;
  } catch {
    return null;
  }
}

export async function takePreviewMarker(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  await rm(file, { force: true });
  return markerVersion(raw);
}
