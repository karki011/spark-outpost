import { useQuery } from '@tanstack/react-query';
import type { CrewDraft } from '@spark-outpost/contracts';
import { ClockIcon } from '../ui/icons.tsx';
import { builderApi, builderKeys } from './builder-api.ts';

const OPEN_POLL_MS = 4_000;
const CLOSED_POLL_MS = 30_000;

const TARGET_LABELS: Record<CrewDraft['target'], string> = {
  spark: 'Spark',
  workflow: 'Workflow',
};

interface BuilderDraftsProps {
  builderOpen: boolean;
  onReview(draft: CrewDraft): void;
}

export function BuilderDrafts({ builderOpen, onReview }: BuilderDraftsProps) {
  const drafts = useQuery({
    queryKey: builderKeys.drafts,
    queryFn: builderApi.drafts,
    refetchInterval: builderOpen ? OPEN_POLL_MS : CLOSED_POLL_MS,
  });
  const list = drafts.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="bld-drafts" aria-labelledby="bld-drafts-title">
      <h2 id="bld-drafts-title" className="sr-only">
        Drafts
      </h2>
      <ul>
        {list.map((draft) => {
          const name = draft.name || `New ${TARGET_LABELS[draft.target].toLowerCase()}`;
          return (
            <li key={draft.approvalId} className="bld-draft">
              <span className="bld-draft-who">
                <b>{name}</b>
                <small>
                  <ClockIcon /> {TARGET_LABELS[draft.target]} · Draft · waiting for you
                </small>
              </span>
              <button
                type="button"
                className="btn sm"
                aria-label={`Review ${name}`}
                onClick={() => onReview(draft)}
              >
                Review
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
