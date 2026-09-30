import { useEffect, useState, type CSSProperties } from 'react';

const PANEL = 'main.main, main.page';
const BELOW_HEADER_PX = 58;

function measure(): CSSProperties | undefined {
  const panel = document.querySelector<HTMLElement>(PANEL);
  if (!panel) return undefined;
  const rect = panel.getBoundingClientRect();
  if (rect.width === 0) return undefined;
  return {
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top + BELOW_HEADER_PX}px`,
    maxWidth: `${Math.max(0, rect.width - 24)}px`,
  };
}

export function usePanelAnchor(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(measure);

  useEffect(() => {
    let watched: HTMLElement | null = null;
    const update = () => setStyle(measure());
    const resize = new ResizeObserver(update);
    const watch = () => {
      const panel = document.querySelector<HTMLElement>(PANEL);
      if (panel === watched) return;
      if (watched) resize.unobserve(watched);
      watched = panel;
      if (panel) resize.observe(panel);
      update();
    };
    const swaps = new MutationObserver(watch);
    swaps.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    watch();
    return () => {
      swaps.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return style;
}
