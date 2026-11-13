import { Fragment } from 'react';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { ForwardIcon } from '../ui/icons.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { listed } from './workflow-model.ts';

interface StagePreviewProps {
  stages: readonly (readonly { stepId: string; sparkId: string }[])[];
  sparks: ReadonlyMap<string, CrewSpark>;
}

export function SparkDot({ spark, size }: { spark: CrewSpark | undefined; size: number }) {
  if (!spark) {
    return <span className="wf-missing" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return <TeammateFace face={spark.face} size={size} />;
}

export function stagesText(
  stages: StagePreviewProps['stages'],
  sparks: ReadonlyMap<string, CrewSpark>,
): string {
  if (stages.length === 0) return 'No steps yet';
  return stages
    .map((stage) => listed(stage.map((step) => sparks.get(step.sparkId)?.name ?? 'Missing Spark')))
    .join(', then ');
}

export function StagePreview({ stages, sparks }: StagePreviewProps) {
  return (
    <span className="wf-mini" role="img" aria-label={stagesText(stages, sparks)}>
      {stages.map((stage, index) => (
        <Fragment key={stage[0]?.stepId ?? index}>
          {index > 0 && (
            <span className="wf-mini-arrow">
              <ForwardIcon />
            </span>
          )}
          <span className="wf-mini-stage">
            {stage.map((step) => (
              <SparkDot key={step.stepId} spark={sparks.get(step.sparkId)} size={22} />
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
