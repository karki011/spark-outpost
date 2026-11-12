export interface SparkWindow {
  id: number;
  island: boolean;
  focused: boolean;
  onScreen: boolean;
}

export function pressWindow(
  windows: readonly SparkWindow[],
  appActive: boolean,
  hasTarget: (id: number) => boolean,
): number | null {
  const focused = windows.find((window) => window.focused);
  if (focused) return !focused.island && hasTarget(focused.id) ? focused.id : null;
  if (!appActive) return null;
  const shown = windows.filter((window) => !window.island && window.onScreen);
  return shown.find((window) => hasTarget(window.id))?.id ?? null;
}
