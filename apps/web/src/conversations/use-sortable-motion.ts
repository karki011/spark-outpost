import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from '@dnd-kit/sortable';
import { useReducedMotion } from 'motion/react';

const SLIDE = { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };

const slideApart: AnimateLayoutChanges = (args) =>
  args.isSorting || defaultAnimateLayoutChanges(args);

export function useSortableMotion() {
  const reduced = useReducedMotion();
  if (reduced) return { transition: null };
  return { transition: SLIDE, animateLayoutChanges: slideApart };
}
