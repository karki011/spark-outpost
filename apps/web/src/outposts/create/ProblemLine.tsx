import { Fragment } from 'react';
import { InfoIcon } from '../../ui/icons.tsx';
import type { ChatProblem } from './create-problems.ts';

interface ProblemLineProps {
  problem: ChatProblem;
  onSuggestion: (handle: string) => void;
}

export function ProblemLine({ problem, onSuggestion }: ProblemLineProps) {
  return (
    <p className="op-problem op-problem-line">
      <InfoIcon />
      <span>
        {problem.message}
        {problem.suggestions.length > 0 && ' Try '}
        {problem.suggestions.map((handle, index) => (
          <Fragment key={handle}>
            {index > 0 && ' or '}
            <button type="button" className="op-suggest" onClick={() => onSuggestion(handle)}>
              @{handle}
            </button>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
