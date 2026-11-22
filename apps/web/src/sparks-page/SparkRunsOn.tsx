import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  modeKind,
  sparkChatMeans,
  sparkJobMeans,
  type TeammateView,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { TeammateDefaults, type DefaultsDraft } from '../teammates/TeammateDefaults.tsx';
import { MoveIcon } from '../ui/icons.tsx';
import { useSparkSave } from './use-spark-save.ts';

const FIELDS = ['provider', 'model', 'effort', 'agentMode', 'level'] as const;

function defaultsOf(spark: TeammateView): DefaultsDraft {
  const { provider, model, effort, agentMode, level } = spark;
  return { provider, model, effort, agentMode, level };
}

function changed(from: DefaultsDraft, to: DefaultsDraft): UpdateTeammateRequest {
  const update: Record<string, unknown> = {};
  for (const field of FIELDS) if (from[field] !== to[field]) update[field] = to[field];
  return update as UpdateTeammateRequest;
}

function withUpdate(stored: DefaultsDraft, update: UpdateTeammateRequest): DefaultsDraft {
  const pick = <K extends keyof DefaultsDraft>(field: K): DefaultsDraft[K] =>
    update[field] === undefined ? stored[field] : (update[field] as DefaultsDraft[K]);
  return {
    provider: pick('provider'),
    model: pick('model'),
    effort: pick('effort'),
    agentMode: pick('agentMode'),
    level: pick('level'),
  };
}

export function SparkRunsOn({ spark }: { spark: TeammateView }) {
  const titleId = useId();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const save = useSparkSave(spark.id);
  const stored = defaultsOf(spark);
  const shown = save.isPending && save.variables ? withUpdate(stored, save.variables) : stored;
  const capabilities = useQuery({
    ...capabilitiesQuery(shown.provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: shown.provider !== null && shown.agentMode !== null,
  });
  const means = sparkChatMeans({
    name: spark.name,
    provider: shown.provider,
    mode: shown.agentMode,
    kind: modeKind(capabilities.data?.modes ?? [], shown.agentMode),
    level: shown.level,
  });
  return (
    <section className="spk-box spk-runs" aria-labelledby={titleId}>
      <h2 id={titleId}>Runs on</h2>
      <p className="spk-hint">
        These apply when you talk to this Spark. A chat or workflow that hands it a job uses its
        provider, model, effort and mode.
      </p>
      <TeammateDefaults
        draft={shown}
        providers={setup.data?.providers ?? []}
        onChange={(next) => {
          const update = changed(stored, next);
          if (Object.keys(update).length > 0) save.mutate(update);
        }}
      />
      <p className="spk-means" data-testid="spark-means">
        <MoveIcon />
        <span>
          <b>What this means.</b> {means} {sparkJobMeans(spark.name)}
        </span>
      </p>
      {save.isError && (
        <p className="spk-problem" role="alert">
          Not saved. {save.error.message}
        </p>
      )}
    </section>
  );
}
