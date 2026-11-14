import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { WorkflowRun, WorkflowStep, WorkflowTestRun } from '@spark-outpost/contracts';
import type { CrewSpark } from './spark-lookup.ts';
import { testRunApi, type TestRunStart as Start } from './test-run-api.ts';
import { TestRunStart } from './TestRunStart.tsx';
import { TestRunView } from './TestRunView.tsx';

interface TestRunProps {
  name: string;
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparkById: ReadonlyMap<string, CrewSpark>;
  form: { title: string; hint: string; placeholder: string; submitLabel: string };
  defaultProjectId?: string | null;
  start: (start: Start) => Promise<WorkflowRun>;
  runForReal?: (start: Start) => Promise<unknown>;
  onClose?: (ranForReal: boolean) => void;
}

function useDiscardOnLeave(runId: string | null) {
  const live = useRef<string | null>(null);
  useEffect(() => {
    live.current = runId;
    if (!runId) return;
    const leave = () => {
      if (live.current === runId) void testRunApi.discard(runId).catch(() => undefined);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [runId]);
  return () => {
    live.current = null;
  };
}

export function TestRun(props: TestRunProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const forget = useDiscardOnLeave(runId);
  const start = useMutation({
    mutationFn: props.start,
    onSuccess: (run) => setRunId(run.id),
  });
  const close = (ranForReal: boolean) => {
    setRunId(null);
    start.reset();
    props.onClose?.(ranForReal);
  };
  const discard = useMutation({
    mutationFn: (id: string) => {
      forget();
      return testRunApi.discard(id);
    },
    onSuccess: () => close(false),
  });
  const real = useMutation({
    mutationFn: async (test: WorkflowTestRun) => {
      await props.runForReal?.({ projectId: test.projectId, message: test.message });
      forget();
      await testRunApi.discard(test.run.id).catch(() => undefined);
    },
    onSuccess: () => close(true),
  });

  if (runId === null) {
    return (
      <TestRunStart
        {...props.form}
        defaultProjectId={props.defaultProjectId ?? null}
        starting={start.isPending}
        error={start.error?.message ?? null}
        onStart={(input) => start.mutate(input)}
        {...(props.onClose ? { onCancel: () => props.onClose?.(false) } : {})}
      />
    );
  }
  return (
    <TestRunView
      runId={runId}
      name={props.name}
      steps={props.steps}
      labels={props.labels}
      sparkById={props.sparkById}
      discarding={discard.isPending}
      onDiscard={() => discard.mutate(runId)}
      {...(props.runForReal ? { onRunForReal: (test) => real.mutate(test) } : {})}
      runForRealPending={real.isPending}
      error={discard.error?.message ?? real.error?.message ?? null}
    />
  );
}
