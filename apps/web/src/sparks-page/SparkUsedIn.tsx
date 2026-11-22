import { useId } from 'react';
import { sparkUsedInLine, type SparkUsage } from '@spark-outpost/contracts';
import { openWorkflow } from '../crew-flows/workflow-route.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { ChevronIcon, WarnIcon } from '../ui/icons.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { usedAnywhere } from './spark-usage-model.ts';
import { useSparkUsage } from './use-spark-save.ts';

interface UsedInListProps {
  usage: SparkUsage;
  onOpenSpark?: ((sparkId: string) => void) | undefined;
  links?: boolean;
}

export function UsedInList({ usage, onOpenSpark, links = true }: UsedInListProps) {
  return (
    <ul className="spk-rows">
      {usage.workflows.map((workflow) => (
        <li key={workflow.id} className="spk-row">
          <span className="spk-row-text">
            <b>{workflow.name}</b>
            <small>{sparkUsedInLine(workflow)}</small>
          </span>
          {links && (
            <button
              type="button"
              className="btn ghost sm spk-row-open"
              aria-label={`Open the workflow ${workflow.name}`}
              onClick={() => openWorkflow(workflow.id)}
            >
              Open <ChevronIcon />
            </button>
          )}
        </li>
      ))}
      {usage.sparks.map((other) => (
        <li key={other.id} className="spk-row">
          <span className="spk-row-text">
            <b>{other.name}</b>
            <small>Spark · its instructions name this Spark</small>
          </span>
          {links && onOpenSpark && (
            <button
              type="button"
              className="btn ghost sm spk-row-open"
              aria-label={`Open the Spark ${other.name}`}
              onClick={() => onOpenSpark(other.id)}
            >
              Open <ChevronIcon />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

interface SparkUsedInProps {
  sparkId: string;
  onOpenSpark: (sparkId: string) => void;
}

export function SparkUsedIn({ sparkId, onOpenSpark }: SparkUsedInProps) {
  const titleId = useId();
  const usage = useSparkUsage(sparkId);
  return (
    <section className="spk-box" aria-labelledby={titleId}>
      <h2 id={titleId}>Used in</h2>
      {usage.isPending && (
        <Skeleton label="Loading where this Spark is used" shape="list" rows={2} />
      )}
      {usage.isError && (
        <p className="spk-problem" role="alert">
          <WarnIcon /> Couldn’t load where this Spark is used. {usage.error.message}
        </p>
      )}
      {usage.data &&
        (usedAnywhere(usage.data) ? (
          <UsedInList usage={usage.data} onOpenSpark={onOpenSpark} />
        ) : (
          <p className="spk-hint">No workflow or other Spark uses this Spark yet.</p>
        ))}
    </section>
  );
}

export function DeleteUsedIn({ sparkId, name }: { sparkId: string; name: string }) {
  const { remote } = useRemoteClient();
  const usage = useSparkUsage(sparkId, !remote);
  if (!usage.data || !usedAnywhere(usage.data)) return null;
  return (
    <div className="spk-delete-used">
      <p className="spk-problem">
        <WarnIcon />
        <span>
          {name} is still used here. Deleting it leaves these pointing at a Spark that is gone.
        </span>
      </p>
      <UsedInList usage={usage.data} links={false} />
    </div>
  );
}
