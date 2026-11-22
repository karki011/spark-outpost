import './crew-flows.css';
import { useCallback, useMemo, useState } from 'react';
import type { WorkflowRun, WorkflowStep } from '@spark-outpost/contracts';
import { rememberWorkflowPlace, rememberedWorkflowPlace } from '../sparks-page/sparks-route.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { NewWorkflow } from './NewWorkflow.tsx';
import { useWorkflowRunRequests } from './run-route.ts';
import { useWorkflowRequests } from './workflow-route.ts';
import { RunView } from './RunView.tsx';
import { useCrewSparks } from './spark-lookup.ts';
import { useWorkflow, useWorkflows } from './use-workflows.ts';
import { WorkflowEditor } from './WorkflowEditor.tsx';
import { WorkflowList } from './WorkflowList.tsx';
import { WorkflowsEmpty } from './WorkflowsEmpty.tsx';
import { workflowId } from './workflow-model.ts';
import { suggestWorkflows } from './workflow-suggestions.ts';

type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'draft'; id: string; name: string; steps: WorkflowStep[] }
  | { kind: 'edit'; id: string }
  | { kind: 'run'; runId: string; seed?: WorkflowRun; from: string | null };

function Problem({ text }: { text: string }) {
  return (
    <p className="wf-problem wf-error" role="alert">
      <WarnIcon />
      <span>
        <b>Couldn’t load</b> · {text}
      </span>
    </p>
  );
}

function startView(): View {
  const place = rememberedWorkflowPlace();
  return place ? { kind: 'edit', id: place.workflowId } : { kind: 'list' };
}

export function WorkflowsPanel() {
  const [view, setView] = useState<View>(startView);
  const list = useWorkflows();
  const crew = useCrewSparks();
  const file = useWorkflow(view.kind === 'edit' ? view.id : null);
  const suggestions = useMemo(() => suggestWorkflows(crew.sparks), [crew.sparks]);
  const toList = () => {
    rememberWorkflowPlace(null);
    setView({ kind: 'list' });
  };
  const edit = (id: string) => {
    if (rememberedWorkflowPlace()?.workflowId !== id) {
      rememberWorkflowPlace({ workflowId: id, tab: 'steps' });
    }
    setView({ kind: 'edit', id });
  };
  useWorkflowRunRequests(
    useCallback((runId: string) => setView({ kind: 'run', runId, from: null }), []),
  );
  useWorkflowRequests(useCallback((id: string) => setView({ kind: 'edit', id }), []));
  const openRun = (from: string | null) => (run: WorkflowRun) =>
    setView({ kind: 'run', runId: run.id, seed: run, from });
  const draft = (name: string, steps: WorkflowStep[]) => {
    const taken = (list.data ?? []).map((workflow) => workflow.id);
    setView({ kind: 'draft', id: workflowId(name, taken), name, steps });
  };

  if (view.kind === 'run') {
    const { from } = view;
    return (
      <div className="wf-panel">
        <RunView
          key={view.runId}
          runId={view.runId}
          {...(view.seed ? { seed: view.seed } : {})}
          sparks={crew.sparks}
          sparkById={crew.byId}
          backLabel={from === null ? 'Workflows' : 'Back to the workflow'}
          onBack={from === null ? toList : () => edit(from)}
        />
      </div>
    );
  }
  if (view.kind === 'draft') {
    return (
      <div className="wf-panel">
        <WorkflowEditor
          key={view.id}
          initial={view}
          baseHash={null}
          sparks={crew.sparks}
          sparkById={crew.byId}
          onClose={toList}
          onOpenRun={openRun(view.id)}
        />
      </div>
    );
  }
  if (view.kind === 'edit') {
    return (
      <div className="wf-panel" aria-busy={file.isPending || undefined}>
        {file.error && (
          <>
            <Problem text={file.error.message} />
            <button type="button" className="btn line sm" onClick={toList}>
              Back to workflows
            </button>
          </>
        )}
        {file.data && (
          <WorkflowEditor
            key={view.id}
            initial={file.data.workflow}
            baseHash={file.data.hash}
            sparks={crew.sparks}
            sparkById={crew.byId}
            onClose={toList}
            onOpenRun={openRun(view.id)}
          />
        )}
      </div>
    );
  }
  if (view.kind === 'new') {
    return (
      <div className="wf-panel">
        <NewWorkflow suggestions={suggestions} onCancel={toList} onCreate={draft} />
      </div>
    );
  }
  const loading = list.isPending || crew.loading;
  const error = list.error ?? crew.error;
  return (
    <div className="wf-panel" aria-busy={loading || undefined}>
      {error && <Problem text={error.message} />}
      {!loading && !error && list.data?.length === 0 && (
        <WorkflowsEmpty
          sparkCount={crew.sparks.length}
          suggestions={suggestions}
          sparkById={crew.byId}
          onNew={() => setView({ kind: 'new' })}
          onUse={(suggestion) => draft(suggestion.name, suggestion.steps)}
        />
      )}
      {!loading && !error && (list.data?.length ?? 0) > 0 && (
        <WorkflowList
          workflows={list.data ?? []}
          sparkById={crew.byId}
          onNew={() => setView({ kind: 'new' })}
          onEdit={edit}
          onOpenRun={openRun(null)}
        />
      )}
    </div>
  );
}
