import { useLayoutEffect } from 'react';
import { afterPaint, sparkDesktop } from '../desktop/desktop-bridge.ts';

let shown = false;

export function useFirstContent(ready: boolean): void {
  useLayoutEffect(() => {
    if (!ready || shown) return;
    shown = true;
    document.getElementById('shell-skeleton')?.remove();
    afterPaint(() => sparkDesktop()?.rendered?.());
  }, [ready]);
}
