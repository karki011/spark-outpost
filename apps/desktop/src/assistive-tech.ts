import { execFile } from 'node:child_process';
import { app, systemPreferences } from 'electron';

const KEYBOARD_NAVIGATION_BIT = 2;
const DEFAULTS_TIMEOUT_MS = 1_500;

export interface AssistiveSignals {
  axClient: boolean;
  keyboardUIMode: number;
  fullKeyboardAccess: boolean;
  fake: boolean;
}

export function assistiveTechOn(signals: AssistiveSignals): boolean {
  return (
    signals.fake ||
    signals.axClient ||
    signals.fullKeyboardAccess ||
    (signals.keyboardUIMode & KEYBOARD_NAVIGATION_BIT) !== 0
  );
}

export function parseDefaultsFlag(output: string): boolean {
  return output.trim() === '1';
}

function readFullKeyboardAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/defaults',
      ['read', 'com.apple.Accessibility', 'FullKeyboardAccessEnabled'],
      { timeout: DEFAULTS_TIMEOUT_MS },
      (error, stdout) => resolve(!error && parseDefaultsFlag(String(stdout))),
    );
  });
}

function readKeyboardUIMode(): number {
  const value: unknown = systemPreferences.getUserDefault('AppleKeyboardUIMode', 'integer');
  return typeof value === 'number' ? value : 0;
}

export async function readAssistiveTech(): Promise<boolean> {
  return assistiveTechOn({
    axClient: app.accessibilitySupportEnabled,
    keyboardUIMode: readKeyboardUIMode(),
    fullKeyboardAccess: await readFullKeyboardAccess(),
    fake: !app.isPackaged && process.env.SPARK_FAKE_ASSISTIVE === '1',
  });
}
