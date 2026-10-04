import { useRef, type MouseEvent } from 'react';
import { prefersReducedMotion } from '../../ui/motion.ts';
import { MarkIcon } from './RailIcons.tsx';
import { OUTLINE_MARK_LABELS, turnAnchor, type OutlineEntry } from './outline-model.ts';
import { useActiveTurn } from './use-active-turn.ts';

function scrollToTurn(runId: string): boolean {
  const section = document.getElementById(turnAnchor(runId));
  if (!section) return false;
  section.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  section.focus({ preventScroll: true });
  return true;
}

export function RailOutline({ entries }: { entries: readonly OutlineEntry[] }) {
  const nav = useRef<HTMLElement>(null);
  const { active, jumped } = useActiveTurn(
    nav,
    entries.map((entry) => entry.runId),
  );
  const jumpTo = (event: MouseEvent, runId: string) => {
    event.preventDefault();
    if (scrollToTurn(runId)) jumped(runId);
  };
  if (entries.length === 0) return null;
  return (
    <nav ref={nav} className="crail-outline" aria-label="On this chat">
      <h3 className="crail-title">On this chat</h3>
      <ol>
        {entries.map((entry) => (
          <li key={entry.runId}>
            <a
              href={`#${turnAnchor(entry.runId)}`}
              aria-current={active === entry.runId ? 'location' : undefined}
              onClick={(event) => jumpTo(event, entry.runId)}
            >
              <span className="crail-o-label">{entry.label}</span>
              {entry.marks.length > 0 && (
                <span className="crail-marks">
                  {entry.marks.map((mark) => (
                    <span
                      key={mark}
                      className={`crail-mark ${mark}`}
                      title={OUTLINE_MARK_LABELS[mark]}
                    >
                      <MarkIcon mark={mark} />
                      <span className="sr-only">{OUTLINE_MARK_LABELS[mark]}</span>
                    </span>
                  ))}
                </span>
              )}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
