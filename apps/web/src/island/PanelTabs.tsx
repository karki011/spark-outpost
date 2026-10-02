import type { Panel } from './island-model.ts';

const TABS: { id: Panel; label: string }[] = [
  { id: 'quick', label: 'New chat' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ask', label: 'Ask' },
];

export function PanelTabs({
  panel,
  waiting,
  onTab,
}: {
  panel: Panel;
  waiting: number;
  onTab: (panel: Panel) => void;
}) {
  return (
    <div className="isl-tabs" role="tablist" aria-label="Spark Island">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === panel}
          onClick={() => tab.id !== panel && onTab(tab.id)}
        >
          {tab.label}
          {tab.id === 'sessions' && waiting > 0 && (
            <span className="isl-badge" aria-label={`${waiting} need you`}>
              {waiting}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
