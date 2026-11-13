import './crew-flows.css';
import './workflow-editor.css';
import { useMemo } from 'react';
import { TRY_IT_WORKFLOW_ID, type TeammateView, type WorkflowStep } from '@spark-outpost/contracts';
import { testRunApi } from './test-run-api.ts';
import { TestRun } from './TestRun.tsx';

export function TrySpark({ spark }: { spark: TeammateView }) {
  const steps = useMemo<WorkflowStep[]>(
    () => [
      {
        id: TRY_IT_WORKFLOW_ID,
        sparkId: spark.id,
        prompt: '',
        dependsOn: [],
        join: 'all',
        onFailure: 'stop',
      },
    ],
    [spark.id],
  );
  const labels = useMemo(() => new Map([[TRY_IT_WORKFLOW_ID, spark.name]]), [spark.name]);
  const sparkById = useMemo(() => new Map([[spark.id, spark]]), [spark]);
  return (
    <div className="wf-panel wf-try">
      <TestRun
        name={spark.name}
        steps={steps}
        labels={labels}
        sparkById={sparkById}
        form={{
          title: 'Try it',
          hint: `A test run of ${spark.name} on a throw-away copy of a project. Nothing is pushed, posted or saved.`,
          placeholder: 'Review the last commit.',
          submitLabel: 'Try it',
        }}
        defaultProjectId={spark.projectIds[0] ?? null}
        start={(start) => testRunApi.startSpark(spark.id, start)}
      />
    </div>
  );
}
