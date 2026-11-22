import { useState } from 'react';
import { useSaveSchedule } from './use-schedule.ts';
import { useSaveTriggers } from './use-triggers.ts';
import { useSaveWorkflow } from './use-workflows.ts';
import {
  dirtyParts,
  draftOf,
  saveDraft,
  saveFailureText,
  unsavedChanges,
  type DraftBaseline,
  type WorkflowDraft,
} from './workflow-draft.ts';

interface DraftStart {
  id: string;
  baseline: DraftBaseline;
  fresh: Pick<WorkflowDraft, 'name' | 'steps'>;
  hash: string | null;
}

export function useWorkflowDraft(start: DraftStart) {
  const [baseline, setBaseline] = useState(start.baseline);
  const [draft, setDraft] = useState(() => draftOf(start.baseline, start.fresh));
  const [hash, setHash] = useState(start.hash);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const workflow = useSaveWorkflow();
  const schedule = useSaveSchedule(start.id);
  const triggers = useSaveTriggers(start.id);
  const dirty = dirtyParts(baseline, draft);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const outcome = await saveDraft(start.id, draft, baseline, hash, {
      workflow: workflow.mutateAsync,
      schedule: schedule.mutateAsync,
      triggers: triggers.mutateAsync,
    });
    setHash(outcome.hash);
    setBaseline(outcome.baseline);
    setFailure(saveFailureText(outcome));
    setSaving(false);
    return outcome.failed.length === 0;
  };

  return {
    baseline,
    draft,
    setDraft,
    hash,
    saving,
    failure,
    dirty: dirty.steps || dirty.schedule || dirty.triggers,
    changes: unsavedChanges(baseline, draft),
    save,
  };
}
