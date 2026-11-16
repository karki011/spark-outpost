import { CrewEmpty } from '../sparks-page/CrewEmpty.tsx';
import { BuilderButton } from '../sparks-page/builder-button.tsx';
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

const WORKFLOW_POINTS = [
  {
    title: 'Together or in order',
    detail: 'Steps run side by side, or wait for the ones before them.',
  },
  {
    title: 'Start it your way',
    detail: 'Run, @name in a chat, on a schedule or on a trigger.',
  },
  {
    title: 'Try it first',
    detail: 'A test run uses real agents on a throw-away copy.',
  },
];

export function WorkflowsEmpty({
  sparkCount,
  suggestions,
  sparkById,
  onNew,
  onUse,
}: WorkflowsEmptyProps) {
  return (
    <CrewEmpty
      title="Combine your crew into a workflow"
      lede="Pick the Sparks, say which run together and which wait. Preview the order before anything runs."
      points={WORKFLOW_POINTS}
      after={<Suggestions suggestions={suggestions} sparkById={sparkById} onUse={onUse} />}
    >
      {sparkCount === 0 ? (
        <p className="wf-hint">
          A workflow runs the Sparks you already have. Add a Spark on the Crew tab first.
        </p>
      ) : (
        <button type="button" className="btn primary sm" onClick={onNew}>
          <PlusIcon />
          New workflow
        </button>
      )}
      <BuilderButton />
    </CrewEmpty>
  );
}

function Suggestions({
  suggestions,
  sparkById,
  onUse,
}: Pick<WorkflowsEmptyProps, 'suggestions' | 'sparkById' | 'onUse'>) {
  if (suggestions.length === 0) return null;
  return (
    <div className="wf-suggest">
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
    </div>
  );
}
