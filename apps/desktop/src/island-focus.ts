export interface FocusableWindow {
  isDestroyed(): boolean;
  setFocusable(focusable: boolean): void;
  focus(): void;
  blur(): void;
  webContents: { focus(): void };
}

export function setIslandFocus(window: FocusableWindow, on: boolean): void {
  if (window.isDestroyed()) return;
  if (on) {
    window.setFocusable(true);
    window.focus();
    window.webContents.focus();
    return;
  }
  window.blur();
  window.setFocusable(false);
}
