import type { WideWindowLayout } from '@spark-outpost/contracts';

export const RAIL_MIN_ROOM = 1040;
export const OUTLINE_MIN_TURNS = 3;

export type RailState = 'open' | 'collapsed' | 'hidden';

interface RailInput {
  roomy: boolean;
  panelOpen: boolean;
  layout: WideWindowLayout;
  collapsed: boolean;
  turns: number;
}

export function railState({ roomy, panelOpen, layout, collapsed, turns }: RailInput): RailState {
  if (!roomy || panelOpen || layout !== 'rail' || turns === 0) return 'hidden';
  return collapsed ? 'collapsed' : 'open';
}

export function panelOpensByDefault(roomy: boolean, layout: WideWindowLayout): boolean {
  return roomy ? layout === 'panel' : true;
}
