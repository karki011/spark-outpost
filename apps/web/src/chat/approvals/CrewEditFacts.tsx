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
import { ReviewFiles, type ReviewFile } from './ReviewFiles.tsx';

const TEAMMATE_NOTE = 'Nothing changes until you answer.';
const DELETE_NOTE = 'This deletes the Spark, its files and folder. It can’t be undone.';

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

function reviewFile(file: CrewFileChange): ReviewFile {
  const badge = CREW_CHANGE_LABELS[file.change];
  const text = file.after ?? file.before ?? '';
  return {
    path: file.path,
    badge,
    bytes: text.length,
    view: newMarkdown(file) ? (
      <MarkdownReview label={`${badge}: ${file.path}`} text={file.after ?? ''} />
    ) : (
      <DiffView
        diff={{ path: file.path, oldText: file.before, newText: file.after ?? '' }}
        badge={badge}
        allRows
      />
    ),
  };
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
      <ReviewFiles files={action.files.map(reviewFile)} />
    </div>
  );
}

export function crewByline(action: SparkAction): string | null {
  return action.action === 'crew_edit' ? crewEditByline(action) : null;
}

export function crewNote(action: SparkAction): string | null {
  if (action.action === 'crew_edit') return CREW_EDIT_NOTE;
  if (action.action === 'delete_teammate') return DELETE_NOTE;
  const teammate = action.action === 'create_teammate' || action.action === 'update_teammate';
  return teammate ? TEAMMATE_NOTE : null;
}
