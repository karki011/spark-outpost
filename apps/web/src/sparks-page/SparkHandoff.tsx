import { useId } from 'react';
import type { TeammateView } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { TeammateProject } from '../teammates/TeammateProject.tsx';
import { useTeammates } from '../teammates/use-teammates.ts';
import { defaultSparkHint } from './spark-usage-model.ts';
import { useSetDefaultSpark, useSparkSave } from './use-spark-save.ts';

export function SparkHandoff({ spark }: { spark: TeammateView }) {
  const titleId = useId();
  const hintId = useId();
  const { teammates, defaultTeammateId } = useTeammates();
  const setDefault = useSetDefaultSpark();
  const stored = defaultTeammateId === spark.id;
  const on = setDefault.isPending ? setDefault.variables === spark.id : stored;
  const current = teammates.find((entry) => entry.id === defaultTeammateId) ?? null;
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <h2 id={titleId}>Who can hand it work</h2>
      <p className="spk-hint">You can always type @{spark.name} in any chat.</p>
      <div className="spk-switch-row">
        <div>
          <b>Use for new chats</b>
          <p className="spk-hint" id={hintId}>
            {defaultSparkHint(spark, current)}
          </p>
        </div>
        <BlobToggle
          label="Use for new chats"
          describedBy={hintId}
          checked={on}
          disabled={setDefault.isPending}
          onChange={(next) => setDefault.mutate(next ? spark.id : null)}
        />
      </div>
      {setDefault.isError && (
        <p className="spk-problem" role="alert">
          Not saved. {setDefault.error.message}
        </p>
      )}
    </section>
  );
}

export function SparkProjects({ spark }: { spark: TeammateView }) {
  const titleId = useId();
  const save = useSparkSave(spark.id);
  const shown =
    save.isPending && save.variables?.projectIds ? save.variables.projectIds : spark.projectIds;
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <h2 id={titleId}>Projects</h2>
      <p className="spk-hint">Chats with this Spark start here.</p>
      <TeammateProject
        projectIds={shown}
        onChange={(projectIds) => {
          if (projectIds.join() !== spark.projectIds.join()) save.mutate({ projectIds });
        }}
      />
      {save.isError && (
        <p className="spk-problem" role="alert">
          Not saved. {save.error.message}
        </p>
      )}
    </section>
  );
}
