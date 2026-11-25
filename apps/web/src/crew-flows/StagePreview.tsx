import { Fragment } from 'react';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { ForwardIcon, WorkflowIcon } from '../ui/icons.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { listed, type StagePreviewStep } from './workflow-model.ts';

const STAGE_FACES = 4;

interface StagePreviewProps {
  stages: readonly (readonly StagePreviewStep[])[];
  sparks: ReadonlyMap<string, CrewSpark>;
}

interface SparkDotProps {
  spark: CrewSpark | undefined;
  size: number;
  workflow?: boolean;
}

export function SparkDot({ spark, size, workflow = false }: SparkDotProps) {
  if (workflow) {
    return (
      <span className="wf-flowdot" style={{ width: size, height: size }} aria-hidden="true">
        <WorkflowIcon />
      </span>
    );
  }
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
    .map((stage) =>
      listed(
        stage.map((step) =>
          step.workflowId !== null
            ? `the ${step.workflowId} workflow`
            : (sparks.get(step.sparkId ?? '')?.name ?? 'Missing Spark'),
        ),
      ),
    )
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
          <span className="wf-mini-stage" data-parallel={stage.length > 1 || undefined}>
            {stage.slice(0, STAGE_FACES).map((step) => (
              <SparkDot
                key={step.stepId}
                spark={sparks.get(step.sparkId ?? '')}
                workflow={step.workflowId !== null}
                size={20}
              />
            ))}
            {stage.length > STAGE_FACES && (
              <span className="wf-mini-more">+{stage.length - STAGE_FACES}</span>
            )}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
