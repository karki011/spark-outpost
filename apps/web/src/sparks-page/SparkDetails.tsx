import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { autonomyLabel, type TeammateView } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { TeammateFields } from '../teammates/TeammateFields.tsx';
import {
  changesFrom,
  draftOf,
  draftProblem,
  type TeammateDraft,
} from '../teammates/teammate-draft.ts';
import { requestTeammateDelete } from '../teammates/teammate-store.ts';
import { teammateKeys, teammatesApi } from '../teammates/teammates-api.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { CheckIcon, LaptopIcon } from '../ui/icons.tsx';
import { TrySpark } from '../crew-flows/TrySpark.tsx';
import { useAgentLine } from './SparkCard.tsx';

interface SparkDetailsProps {
  spark: TeammateView;
  onInstructions: () => void;
  onDeleted: () => void;
}

export function SparkDetails({ spark, onInstructions, onDeleted }: SparkDetailsProps) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<TeammateDraft>(() => draftOf(spark));
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () => teammatesApi.update(spark.id, changesFrom(spark, draft)),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: teammateKeys.all }),
        client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });
  const problem = draftProblem(draft);
  const unchanged = Object.keys(changesFrom(spark, draft)).length === 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!problem && !unchanged) save.mutate();
  };
  const shownProblem = (touched && problem) || save.error?.message;
  return (
    <>
      <form className="spk-details" onSubmit={submit} noValidate>
        <TeammateFields
          draft={draft}
          nameInvalid={touched && !draft.name.trim()}
          onChange={(next) => {
            save.reset();
            setDraft(next);
          }}
        />
        <div className="field">
          <span>Instructions</span>
          <p className="spk-hint">
            Kept in SPARK.md in this Spark’s folder, with no length limit, and added to every chat
            with it.
          </p>
          <button type="button" className="btn line sm spk-start" onClick={onInstructions}>
            Edit instructions
          </button>
        </div>
        <div className="spk-details-acts">
          {shownProblem && (
            <p className="spk-problem" role="alert">
              {shownProblem}
            </p>
          )}
          {save.isSuccess && unchanged && (
            <span className="spk-state" role="status">
              <CheckIcon /> Saved
            </span>
          )}
          <button type="submit" className="btn primary sm" disabled={save.isPending || unchanged}>
            Save
          </button>
        </div>
        <div className="tm-danger">
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
      </form>
      <section className="spk-details spk-try" aria-label="Try it">
        <TrySpark key={spark.id} spark={spark} />
      </section>
    </>
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
