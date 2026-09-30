import './pending-dock.css';
import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownIcon, ArrowUpIcon } from '../../ui/icons.tsx';
import { useExpandReveal } from '../../ui/transitions.tsx';
import { dockAnnouncement, shownEntry, stepTo } from './dock-model.ts';
import type { PendingDockState } from './use-pending-dock.ts';

function DockSlot({
  id,
  hidden,
  onSlot,
}: {
  id: string;
  hidden: boolean;
  onSlot: PendingDockState['setSlot'];
}) {
  const ref = useCallback((element: HTMLDivElement | null) => onSlot(id, element), [id, onSlot]);
  return <div ref={ref} className="dock-slot" data-dock-slot={id} hidden={hidden} tabIndex={-1} />;
}

export function PendingDock({ dock }: { dock: PendingDockState }) {
  const { entries, chosen, choose, setSlot, dockRef } = dock;
  const shown = shownEntry(entries, chosen);
  const position = shown ? entries.indexOf(shown) + 1 : 0;
  const expand = useExpandReveal();
  return (
    <>
      <p className="sr-only" role="status">
        {dockAnnouncement(entries)}
      </p>
      <AnimatePresence initial={false}>
        {shown && (
          <motion.section
            key="dock"
            className="pending-dock"
            aria-label="Waiting for you"
            {...expand}
          >
            <div className="dock-inner" ref={dockRef}>
              {entries.length > 1 && (
                <div className="dock-step">
                  <span className="dock-step-what">Waiting for you</span>
                  <span className="dock-step-count">
                    {position} of {entries.length}
                  </span>
                  <button
                    type="button"
                    className="dock-nav"
                    aria-label="Previous waiting card"
                    onClick={() => choose(stepTo(entries, shown, -1))}
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    className="dock-nav"
                    aria-label="Next waiting card"
                    onClick={() => choose(stepTo(entries, shown, 1))}
                  >
                    <ArrowDownIcon />
                  </button>
                </div>
              )}
              <div className="dock-cards">
                {entries.map((entry) => (
                  <DockSlot
                    key={entry.id}
                    id={entry.id}
                    hidden={entry.id !== shown.id}
                    onSlot={setSlot}
                  />
                ))}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
