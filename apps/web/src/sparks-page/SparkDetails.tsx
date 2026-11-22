import { useId, useState, type FormEvent } from 'react';
import { autonomyLabel, type TeammateView } from '@spark-outpost/contracts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { TeammateIdentityFields } from '../teammates/TeammateFields.tsx';
import {
  changesFrom,
  draftOf,
  draftProblem,
  type TeammateDraft,
} from '../teammates/teammate-draft.ts';
import { requestTeammateDelete } from '../teammates/teammate-store.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { LaptopIcon } from '../ui/icons.tsx';
import { useAgentLine } from './SparkCard.tsx';
import { DeleteUsedIn } from './SparkUsedIn.tsx';
import { useSparkSave } from './use-spark-save.ts';

interface SparkIdentityProps {
  spark: TeammateView;
  onDeleted: () => void;
}

export function SparkIdentity({ spark, onDeleted }: SparkIdentityProps) {
  const titleId = useId();
  const [draft, setDraft] = useState<TeammateDraft>(() => draftOf(spark));
  const [touched, setTouched] = useState(false);
  const save = useSparkSave(spark.id);
  const problem = draftProblem(draft);
  const { name, role, face } = changesFrom(spark, draft);
  const changes = {
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(face !== undefined ? { face } : {}),
  };
  const unchanged = Object.keys(changes).length === 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!problem && !unchanged) save.mutate(changes);
  };
  const shownProblem = (touched && problem) || save.error?.message;
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <h2 id={titleId}>Name and look</h2>
      <form className="spk-identity" onSubmit={submit} noValidate>
        <TeammateIdentityFields
          draft={draft}
          nameInvalid={touched && !draft.name.trim()}
          onChange={(next) => {
            save.reset();
            setDraft(next);
          }}
        />
        <div className="spk-details-acts">
          {shownProblem && (
            <p className="spk-problem" role="alert">
              {shownProblem}
            </p>
          )}
          <button type="submit" className="btn primary sm" disabled={save.isPending || unchanged}>
            Save
          </button>
        </div>
      </form>
      <div className="tm-danger">
        <DeleteUsedIn sparkId={spark.id} name={spark.name} />
        <HoldToConfirm
          label={`Hold to delete ${spark.name}`}
          hint="Its chats stay and lose the link. You get 10 seconds to undo."
          holdingHint="Keep holding. Let go now to cancel."
          releasedHint="Released early. Nothing happened."
          onConfirm={() => {
            requestTeammateDelete({ id: spark.id, name: spark.name });
            onDeleted();
          }}
        />
      </div>
    </section>
  );
}

export function SparkSummary({ spark }: { spark: TeammateView }) {
  const agent = useAgentLine(spark);
  const projects = useProjects();
  const project = projects.data?.find((entry) => entry.id === spark.projectIds[0]);
  return (
    <div className="spk-summary">
      <dl className="spk-facts">
        <dt>Role</dt>
        <dd>{spark.role || 'None'}</dd>
        <dt>Agent and mode</dt>
        <dd>{agent}</dd>
        <dt>Spark autonomy</dt>
        <dd>{spark.level ? autonomyLabel(spark.level) : 'Spark default'}</dd>
        <dt>Default project</dt>
        <dd>{project?.name ?? 'No project'}</dd>
      </dl>
      <p className="spk-mac-only">
        <LaptopIcon /> Edit this Spark, its instructions, skills and files on the Mac.
      </p>
    </div>
  );
}
