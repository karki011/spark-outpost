import type { WideWindowLayout } from '@spark-outpost/contracts';

export const RAIL_MIN_ROOM = 1040;

export type RailState = 'open' | 'collapsed' | 'overlay' | 'hidden';

interface RailInput {
  phone: boolean;
  roomy: boolean;
  panelOpen: boolean;
  layout: WideWindowLayout;
  collapsed: boolean;
  turns: number;
}

export function railState({
  phone,
  roomy,
  panelOpen,
  layout,
  collapsed,
  turns,
}: RailInput): RailState {
  if (phone || layout !== 'rail' || turns === 0) return 'hidden';
  if (!roomy || panelOpen) return 'overlay';
  return collapsed ? 'collapsed' : 'open';
}

export function panelOpensByDefault(roomy: boolean, layout: WideWindowLayout): boolean {
  return roomy ? layout === 'panel' : true;
}

export function railClass(rail: RailState, floatingOpen: boolean): string {
  if (rail === 'hidden') return 'main';
  if (rail === 'overlay')
    return floatingOpen ? 'main crail-overlay crail-floating' : 'main crail-overlay';
  return `main crail-${rail}`;
}
