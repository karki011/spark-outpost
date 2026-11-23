import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import { badgeDotPixels, BADGE_DOT_SIZE } from './badge-dot.ts';

let dot: NativeImage | null = null;

function badgeDot(): NativeImage {
  dot ??= nativeImage.createFromBitmap(badgeDotPixels(BADGE_DOT_SIZE), {
    width: BADGE_DOT_SIZE,
    height: BADGE_DOT_SIZE,
  });
  return dot;
}

export function showAppBadge(badge: string, window: BrowserWindow | null): void {
  if (process.platform !== 'win32') {
    app.dock?.setBadge(badge);
    return;
  }
  if (!window || window.isDestroyed()) return;
  window.setOverlayIcon(badge ? badgeDot() : null, badge);
}
