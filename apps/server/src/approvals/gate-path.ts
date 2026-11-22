import path from 'node:path';
import { relativeInside } from '../projects/path-policy.ts';

export const gatePaths = path.posix;

const WINDOWS_DRIVE = /^([A-Za-z]):(?:[\\/]|$)(.*)$/s;
const WINDOWS_UNC = /^\\\\([^\\/]+)[\\/]([^\\/]+)(.*)$/s;
const GATE_DRIVE = /^\/([A-Za-z])(?:\/(.*))?$/s;

export function toGatePath(native: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return native;
  const drive = WINDOWS_DRIVE.exec(native);
  if (drive) return gatePaths.join(`/${drive[1]!.toLowerCase()}`, forward(drive[2]!));
  const unc = WINDOWS_UNC.exec(native);
  if (unc) return `//${unc[1]}/${unc[2]}${forward(unc[3]!)}`;
  return native;
}

export function toNativePath(gate: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return gate;
  const drive = GATE_DRIVE.exec(gate);
  if (!drive) return gate;
  return path.win32.join(`${drive[1]!.toUpperCase()}:\\`, drive[2] ?? '');
}

export function isWindowsPath(word: string): boolean {
  return WINDOWS_DRIVE.test(word) || WINDOWS_UNC.test(word);
}

function forward(rest: string): string {
  return rest.replaceAll('\\', '/');
}

export function gateRelativeInside(root: string, target: string): string | null {
  return relativeInside(root, target, gatePaths);
}

export function gateRelative(native: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? forward(native) : native;
}
