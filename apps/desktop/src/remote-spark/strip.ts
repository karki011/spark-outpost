import { session, type Session } from 'electron';
import { escaped } from './load-state.ts';

export const STRIP_HEIGHT = 32;
export const STRIP_PARTITION = 'spark-window-strip';

const PAGE_PREFIX = 'data:text/html;charset=utf-8,';

interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function stripLayout(
  width: number,
  height: number,
): { strip: ViewBounds; remote: ViewBounds } {
  return {
    strip: { x: 0, y: 0, width, height: STRIP_HEIGHT },
    remote: { x: 0, y: STRIP_HEIGHT, width, height: Math.max(0, height - STRIP_HEIGHT) },
  };
}

export function stripPage(name: string, hostname: string): string {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>Remote control</title>
<style>
html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;align-items:center;gap:8px;box-sizing:border-box;padding:0 12px;font:13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8e4d3;color:#4a1d00;border-bottom:1px solid #b34f00;cursor:default;user-select:none;-webkit-user-select:none;white-space:nowrap}
svg{flex:none}
strong{flex:none;font-weight:600}
span{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis}
span+span{flex:0 1 auto;max-width:none;opacity:.8}
@media (prefers-color-scheme:dark){body{background:#272145;color:#e3ddff;border-bottom-color:#9d8aff}}
@media (prefers-contrast:more){body{background:Canvas;color:CanvasText;border-bottom:2px solid CanvasText}span+span{opacity:1}}
</style>
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="10" height="7" rx="1.2"/><path d="M1.5 12.5h13"/></svg>
<strong>Remote control</strong>
<span>${escaped(name)}</span>
<span>${escaped(hostname)}</span>
</html>`;
  return `${PAGE_PREFIX}${encodeURIComponent(html)}`;
}

export function stripSession(): Session {
  const target = session.fromPartition(STRIP_PARTITION);
  if (target === session.defaultSession) {
    throw new Error('The remote Spark strip never uses the app session.');
  }
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(PAGE_PREFIX) });
  });
  return target;
}
