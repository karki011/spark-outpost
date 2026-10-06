import { execFile } from 'node:child_process';
import type { Size } from './island-geometry.ts';

export type Notches = ReadonlyMap<number, Size | null>;

const OSASCRIPT = '/usr/bin/osascript';
const PROBE_TIMEOUT_MS = 5_000;
const MAX_NOTCH_WIDTH = 600;
const MAX_NOTCH_HEIGHT = 120;

const SCRIPT = `
ObjC.import('AppKit');
const screens = $.NSScreen.screens;
const out = [];
for (let i = 0; i < screens.count; i++) {
  const screen = screens.objectAtIndex(i);
  out.push({
    id: ObjC.unwrap(screen.deviceDescription.objectForKey('NSScreenNumber')),
    width: screen.frame.size.width,
    top: screen.safeAreaInsets.top,
    left: screen.auxiliaryTopLeftArea.size.width,
    right: screen.auxiliaryTopRightArea.size.width,
  });
}
JSON.stringify(out);
`;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function notchOf(record: Record<string, unknown>): Size | null {
  const { width, top, left, right } = record;
  if (!finite(width) || !finite(top) || !finite(left) || !finite(right)) return null;
  if (top <= 0 || left <= 0 || right <= 0) return null;
  const covered = width - 2 * Math.min(left, right);
  if (covered <= 0 || covered > MAX_NOTCH_WIDTH || top > MAX_NOTCH_HEIGHT) return null;
  return { width: covered, height: top };
}

export function parseNotches(raw: string): Map<number, Size | null> {
  const notches = new Map<number, Size | null>();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return notches;
  }
  if (!Array.isArray(value)) return notches;
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (finite(record.id)) notches.set(record.id, notchOf(record));
  }
  return notches;
}

export function emulatedNotch(value: string | undefined): Size | null {
  const match = /^(\d{2,3})x(\d{2,3})$/.exec(value ?? '');
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function readNotches(): Promise<Notches> {
  return new Promise((resolve) => {
    execFile(
      OSASCRIPT,
      ['-l', 'JavaScript', '-e', SCRIPT],
      { timeout: PROBE_TIMEOUT_MS },
      (error, stdout) => resolve(error ? new Map() : parseNotches(stdout)),
    );
  });
}
