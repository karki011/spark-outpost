import { useState, type KeyboardEvent } from 'react';
import { TerminalCost } from './TerminalCost.tsx';
import { TerminalSteps } from './TerminalSteps.tsx';

const TABS = ['steps', 'cost'] as const;
type UsageTab = (typeof TABS)[number];
const TAB_NAMES: Record<UsageTab, string> = { steps: 'Steps', cost: 'Cost' };

export function TerminalWork({ conversationId }: { conversationId: string }) {
  const [tab, setTab] = useState<UsageTab>('steps');
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tab === 'steps' ? 'cost' : 'steps';
    setTab(next);
    document.getElementById(`tutab-${next}`)?.focus();
  };
  return (
    <>
      <div className="wtabs" role="tablist" aria-label="Terminal session details">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tutab-${id}`}
            aria-selected={tab === id}
            aria-controls="tupane"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onKey}
          >
            {TAB_NAMES[id]}
          </button>
        ))}
      </div>
      <div className="wpane" id="tupane" role="tabpanel" aria-labelledby={`tutab-${tab}`}>
        {tab === 'steps' ? (
          <TerminalSteps conversationId={conversationId} />
        ) : (
          <TerminalCost conversationId={conversationId} />
        )}
      </div>
    </>
  );
}
