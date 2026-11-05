import type { MenuAnchor } from './MenuShell.tsx';
import type { Point } from './use-sidebar-dnd.ts';

export interface OpenMenu {
  chatId: string;
  anchor: MenuAnchor;
}

export interface OpenProjectMenu {
  projectId: string;
  anchor: MenuAnchor;
}

export function anchorFor(element: HTMLElement, point: Point | null): MenuAnchor {
  const rect = element.getBoundingClientRect();
  if (point) return { x: point.x, y: point.y + 4, above: point.y - 4, focusBack: element };
  return { x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: element };
}
