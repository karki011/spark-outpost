import '../../teammates/spark-mention.css';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  SPARK_MENTION_HINT,
  WORKFLOW_MENTION_HINT,
  type TeammateView,
} from '@spark-outpost/contracts';
import type { MentionWorkflow } from '../../crew-flows/workflow-mentions.ts';
import { TeammateFace } from '../../teammates/TeammateFace.tsx';
import { ResumeIcon, SparkleIcon, WarnIcon, WorkflowIcon } from '../../ui/icons.tsx';
import { FileList } from './FileList.tsx';
import type { FileSearch, RepoFile } from './use-file-search.ts';
import { sparkListId, sparkOptionId, workflowListId, workflowOptionId } from './use-mention.ts';

interface MentionPickerProps {
  listId: string;
  left: number;
  sparks: readonly TeammateView[];
  workflows: readonly MentionWorkflow[];
  active: number;
  showsFiles: boolean;
  search: FileSearch;
  attached: ReadonlySet<string>;
  onActive: (index: number) => void;
  onPick: (file: RepoFile) => void;
  onPickSpark: (spark: TeammateView) => void;
  onPickWorkflow: (workflow: MentionWorkflow) => void;
}

const PANEL_WIDTH = 340;

function KindTag({ icon, word }: { icon: ReactNode; word: string }) {
  return (
    <span className="mention-kind">
      {icon} {word}
    </span>
  );
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const named = sparks.length + workflows.length;
  useEffect(() => {
    if (active >= named) return;
    panelRef.current
      ?.querySelector('.sparkopt[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, named]);
  return (
    <div
      ref={panelRef}
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
                  <small>{spark.role || 'No role'}</small>
                </span>
                <KindTag icon={<SparkleIcon />} word="Spark" />
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
            {workflows.map((entry, index) => {
              const { workflow, blocked } = entry;
              const at = sparks.length + index;
              return (
                <div
                  key={workflow.id}
                  id={workflowOptionId(listId, index)}
                  className="fopt sparkopt"
                  role="option"
                  aria-selected={at === active}
                  aria-disabled={blocked !== null}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => {
                    if (at !== active) onActive(at);
                  }}
                  onClick={() => onPickWorkflow(entry)}
                >
                  <span className="flow-mark" aria-hidden="true">
                    {blocked ? <WarnIcon /> : <ResumeIcon />}
                  </span>
                  <span className="fname">
                    <b>{workflow.name}</b>
                    <small>{blocked ?? `@${workflow.id}`}</small>
                  </span>
                  <KindTag icon={<WorkflowIcon />} word="Workflow" />
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
