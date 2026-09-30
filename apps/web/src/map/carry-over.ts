import type { HoverTarget } from './frame.ts';
import type { Scene } from './scene.ts';

export interface Carried {
  focusFile: number;
  focusArea: number;
  hover: HoverTarget | null;
  pinned: { index: number; at: number } | null;
}

export function carryOver(previous: Scene, scene: Scene, state: Carried): Carried {
  const file = (index: number) =>
    index < 0 ? -1 : (scene.fileByKey.get(previous.files[index]?.key ?? '') ?? -1);
  const area = (index: number) => scene.areaByKey.get(previous.areas[index]?.key ?? '') ?? -1;
  const hover = state.hover;
  let nextHover: HoverTarget | null = hover;
  if (hover?.type === 'file') {
    const index = file(hover.index);
    nextHover = index < 0 ? null : { type: 'file', index };
  } else if (hover?.type === 'area') {
    const index = area(hover.index);
    nextHover = index < 0 ? null : { type: 'area', index };
  }
  const pinned = state.pinned ? file(state.pinned.index) : -1;
  return {
    focusFile: file(state.focusFile),
    focusArea: area(state.focusArea),
    hover: nextHover,
    pinned: state.pinned && pinned >= 0 ? { ...state.pinned, index: pinned } : null,
  };
}
