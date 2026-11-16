import './crew-edit.css';
import {
  CREW_CHANGE_LABELS,
  CREW_EDIT_NOTE,
  crewEditByline,
  crewSimilarText,
  type CrewEditAction,
  type CrewFileChange,
  type CrewSimilar,
  type SparkAction,
} from '@spark-outpost/contracts';
import { WarnIcon } from '../../ui/icons.tsx';
import { DiffView } from './DiffView.tsx';
import { MarkdownReview } from './MarkdownReview.tsx';

const TEAMMATE_NOTE = 'Only you can answer this. Nothing changes until you do.';

export function SimilarNote({ similar }: { similar: readonly CrewSimilar[] }) {
  if (similar.length === 0) return null;
  return (
    <p className="sac-crew-similar" role="note">
      <span className="ic" aria-hidden="true">
        <WarnIcon />
      </span>
      <span>You already have {similar.map(crewSimilarText).join('; ')}.</span>
    </p>
  );
}

function newMarkdown(file: CrewFileChange): boolean {
  return file.change === 'new' && Boolean(file.after) && /\.md$/i.test(file.path);
}

function stagesText(stages: readonly (readonly string[])[]): string {
  return stages.map((stage) => stage.join(' + ')).join(' → ');
}

export function CrewEditFacts({ action }: { action: CrewEditAction }) {
  return (
    <div className="sac-crew">
      {action.stages && action.stages.length > 0 && (
        <dl className="sac-facts">
          <dt>Steps</dt>
          <dd>{stagesText(action.stages)}</dd>
        </dl>
      )}
      <SimilarNote similar={action.similar} />
      <ul className="sac-crew-files" aria-label="File changes">
        {action.files.map((file) => (
          <li key={file.path}>
            {newMarkdown(file) ? (
              <MarkdownReview
                label={`${CREW_CHANGE_LABELS[file.change]}: ${file.path}`}
                text={file.after ?? ''}
              />
            ) : (
              <DiffView
                diff={{ path: file.path, oldText: file.before, newText: file.after ?? '' }}
                badge={CREW_CHANGE_LABELS[file.change]}
                allRows
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function crewByline(action: SparkAction): string | null {
  return action.action === 'crew_edit' ? crewEditByline(action) : null;
}

export function crewNote(action: SparkAction): string | null {
  if (action.action === 'crew_edit') return CREW_EDIT_NOTE;
  const teammate = action.action === 'create_teammate' || action.action === 'update_teammate';
  return teammate ? TEAMMATE_NOTE : null;
}
