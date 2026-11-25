import './prepared-setups.css';
import { setupTargets, type SetupTarget } from '@spark-outpost/contracts';
import { useSetupDrafts } from './use-setup-drafts.ts';

export function PreparedSetups({ targets }: { targets: readonly SetupTarget[] }) {
  const { drafts, clear } = useSetupDrafts();
  const shown = drafts.filter((draft) => targets.includes(draft.target));
  if (shown.length === 0) return null;
  return (
    <ul className="prepared-setups" aria-label="Prepared by an agent">
      {shown.map((draft) => {
        const facts = setupTargets[draft.target];
        return (
          <li key={draft.target}>
            <span>
              <b>{facts.name}</b> was prepared by an agent. {facts.finish}
            </span>
            <button type="button" className="btn sm" onClick={() => clear(draft.target)}>
              Dismiss<span className="sr-only"> the prepared {facts.name} setup</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
