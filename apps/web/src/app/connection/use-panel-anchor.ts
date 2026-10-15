import { useEffect, useState, type CSSProperties } from 'react';

const PANEL = 'main.main, main.page';
const BELOW_HEADER_PX = 58;

function findPanel(): HTMLElement | null {
  const panels = document.querySelectorAll<HTMLElement>(PANEL);
  return [...panels].find((panel) => panel.getClientRects().length > 0) ?? null;
}

function measure(panel: HTMLElement | null): CSSProperties | undefined {
  if (!panel) return undefined;
  const rect = panel.getBoundingClientRect();
  if (rect.width === 0) return undefined;
  return {
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top + BELOW_HEADER_PX}px`,
    maxWidth: `${Math.max(0, rect.width - 24)}px`,
  };
}

function useWatchedPanel(onChange: (panel: HTMLElement | null) => void, sizes: boolean): void {
  useEffect(() => {
    let watched: HTMLElement | null = null;
    const update = () => onChange(watched);
    const resize = new ResizeObserver(update);
    const watch = () => {
      const panel = findPanel();
      if (panel === watched) return;
      if (watched && sizes) resize.unobserve(watched);
      watched = panel;
      if (panel && sizes) resize.observe(panel);
      update();
    };
    const swaps = new MutationObserver(watch);
    swaps.observe(document.body, { childList: true, subtree: true });
    if (sizes) window.addEventListener('resize', update);
    watch();
    return () => {
      swaps.disconnect();
      resize.disconnect();
      if (sizes) window.removeEventListener('resize', update);
    };
  }, [onChange, sizes]);
}

export function usePanelElement(): HTMLElement | null {
  const [panel, setPanel] = useState<HTMLElement | null>(findPanel);
  useWatchedPanel(setPanel, false);
  return panel;
}

export function usePanelAnchor(): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(() => measure(findPanel()));
  const [update] = useState(() => (panel: HTMLElement | null) => setStyle(measure(panel)));
  useWatchedPanel(update, true);
  return style;
}
