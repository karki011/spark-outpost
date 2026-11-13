import { SPARK_INSTRUCTIONS_FILE, autonomyLabel, type SparkAction } from '@spark-outpost/contracts';
import { DiffView } from '../chat/approvals/DiffView.tsx';
import { SimilarNote } from '../chat/approvals/CrewEditFacts.tsx';
import { TeammateFace } from './TeammateFace.tsx';

type TeammateAction = Extract<SparkAction, { action: 'create_teammate' | 'update_teammate' }>;

const LABELS: Record<string, string> = {
  name: 'Name',
  role: 'Role',
  face: 'Face',
  provider: 'Provider',
  model: 'Model',
  agentMode: 'Mode',
  level: 'Autonomy',
  instructions: 'Instructions',
  projectIds: 'Projects',
};

export function TeammateFacts({ action }: { action: TeammateAction }) {
  const changed = action.action === 'update_teammate' ? action.changed : null;
  const defaults = [
    action.provider ?? 'Default provider',
    action.model,
    action.agentMode,
    action.level ? autonomyLabel(action.level) : null,
  ].filter(Boolean);
  const before = action.action === 'update_teammate' ? action.instructionsBefore : undefined;
  const similar = action.action === 'create_teammate' ? (action.similar ?? []) : [];
  return (
    <>
      <dl className="sac-facts">
        <dt>Spark</dt>
        <dd className="tm-fact-name">
          <TeammateFace face={action.face} size={22} />
          <span>
            {action.name}
            {action.role && ` · ${action.role}`}
          </span>
        </dd>
        {changed && (
          <>
            <dt>Changes</dt>
            <dd>{changed.map((field) => LABELS[field] ?? field).join(', ')}</dd>
          </>
        )}
        <dt>Defaults</dt>
        <dd>{defaults.join(' · ')}</dd>
        {action.projects.length > 0 && (
          <>
            <dt>Projects</dt>
            <dd>{action.projects.map((project) => project.name).join(', ')}</dd>
          </>
        )}
        {before === undefined && (
          <>
            <dt>Instructions</dt>
            <dd className="tm-fact-text">{action.instructions || 'None'}</dd>
          </>
        )}
      </dl>
      {before !== undefined && (
        <DiffView
          diff={{ path: SPARK_INSTRUCTIONS_FILE, oldText: before, newText: action.instructions }}
          badge="Instructions"
          allRows
        />
      )}
      <SimilarNote similar={similar} />
    </>
  );
}
