import '../../teammates/spark-mention.css';
import {
  SPARK_MENTION_HINT,
  WORKFLOW_MENTION_HINT,
  type TeammateView,
  type WorkflowSummary,
} from '@spark-outpost/contracts';
import { TeammateFace } from '../../teammates/TeammateFace.tsx';
import { ResumeIcon } from '../../ui/icons.tsx';
import { FileList } from './FileList.tsx';
import type { FileSearch, RepoFile } from './use-file-search.ts';
import { sparkListId, sparkOptionId, workflowListId, workflowOptionId } from './use-mention.ts';

interface MentionPickerProps {
  listId: string;
  left: number;
  sparks: readonly TeammateView[];
  workflows: readonly WorkflowSummary[];
  active: number;
  showsFiles: boolean;
  search: FileSearch;
  attached: ReadonlySet<string>;
  onActive: (index: number) => void;
  onPick: (file: RepoFile) => void;
  onPickSpark: (spark: TeammateView) => void;
  onPickWorkflow: (workflow: WorkflowSummary) => void;
}

const PANEL_WIDTH = 340;

export function MentionPicker({
  listId,
  left,
  sparks,
  workflows,
  active,
  showsFiles,
  search,
  attached,
  onActive,
  onPick,
  onPickSpark,
  onPickWorkflow,
}: MentionPickerProps) {
  return (
    <div
      className="mpop left filepop mentionpop open"
      style={{ left: `clamp(0px, ${left}px, calc(100% - ${PANEL_WIDTH}px))` }}
    >
      {sparks.length > 0 && (
        <>
          <div
            id={sparkListId(listId)}
            className="flist sparklist"
            role="listbox"
            aria-label="Sparks"
          >
            {sparks.map((spark, index) => (
              <div
                key={spark.id}
                id={sparkOptionId(listId, index)}
                className="fopt sparkopt"
                role="option"
                aria-selected={index === active}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (index !== active) onActive(index);
                }}
                onClick={() => onPickSpark(spark)}
              >
                <TeammateFace face={spark.face} size={20} state={spark.state} />
                <span className="fname">
                  <b>{spark.name}</b>
                  <small>{spark.role || 'Spark'}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="eff-note spark-hint">{SPARK_MENTION_HINT}</p>
        </>
      )}
      {workflows.length > 0 && (
        <>
          <div
            id={workflowListId(listId)}
            className="flist sparklist"
            role="listbox"
            aria-label="Workflows"
          >
            {workflows.map((workflow, index) => {
              const at = sparks.length + index;
              return (
                <div
                  key={workflow.id}
                  id={workflowOptionId(listId, index)}
                  className="fopt sparkopt"
                  role="option"
                  aria-selected={at === active}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => {
                    if (at !== active) onActive(at);
                  }}
                  onClick={() => onPickWorkflow(workflow)}
                >
                  <span className="flow-mark" aria-hidden="true">
                    <ResumeIcon />
                  </span>
                  <span className="fname">
                    <b>{workflow.name}</b>
                    <small>@{workflow.id}</small>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="eff-note spark-hint">{WORKFLOW_MENTION_HINT}</p>
        </>
      )}
      {showsFiles && <FileList id={listId} search={search} attached={attached} onPick={onPick} />}
    </div>
  );
}
