import { PlusIcon } from '../ui/icons.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { StagePreview } from './StagePreview.tsx';
import { stagePreview } from './workflow-model.ts';
import type { WorkflowSuggestion } from './workflow-suggestions.ts';

interface WorkflowsEmptyProps {
  sparkCount: number;
  suggestions: readonly WorkflowSuggestion[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  onNew: () => void;
  onUse: (suggestion: WorkflowSuggestion) => void;
}

export function WorkflowsEmpty({
  sparkCount,
  suggestions,
  sparkById,
  onNew,
  onUse,
}: WorkflowsEmptyProps) {
  return (
    <div className="wf-empty">
      <h2>Combine your crew into a workflow</h2>
      <p>
        Pick the Sparks, say which run together and which wait. Preview the order before anything
        runs.
      </p>
      {sparkCount === 0 ? (
        <p className="wf-hint">
          A workflow runs the Sparks you already have. Add a Spark on the Crew tab first.
        </p>
      ) : (
        <button type="button" className="btn primary" onClick={onNew}>
          <PlusIcon />
          New workflow
        </button>
      )}
      {suggestions.length > 0 && (
        <>
          <h3>Suggested from your crew</h3>
          <ul className="wf-suggestions" aria-label="Suggested workflows">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="wf-card">
                <b>{suggestion.name}</b>
                <small>{suggestion.detail}</small>
                <StagePreview stages={stagePreview(suggestion.steps)} sparks={sparkById} />
                <button
                  type="button"
                  className="btn line sm"
                  aria-label={`Use ${suggestion.name}`}
                  onClick={() => onUse(suggestion)}
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
