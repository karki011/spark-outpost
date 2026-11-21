import './sub-chats-plan.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  subChatPlacement,
  type PlannedSubChat,
  type SparkAction,
  type SparkActionEdits,
  type StartSubChatsAction,
  type SubChatEdit,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../../api/client.ts';
import { modelName } from '../../tasks/model-names.ts';
import { ChoicePicker, type PickerChoice } from '../../ui/ChoicePicker.tsx';
import { selectableEfforts, shortLabel, visibleModels } from '../composer/model-options.ts';

type Patch = Pick<SubChatEdit, 'model' | 'effort'>;

export interface SubChatsPlanDraft {
  editing: boolean;
  edits: readonly SubChatEdit[];
  toggleEditing: () => void;
  change: (id: string, patch: Patch) => void;
}

export function useSubChatsPlanDraft(): SubChatsPlanDraft {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<readonly SubChatEdit[]>([]);
  return {
    editing,
    edits,
    toggleEditing: () => setEditing((current) => !current),
    change: (id, patch) =>
      setEdits((current) => {
        const before = current.find((edit) => edit.id === id) ?? { id };
        return [...current.filter((edit) => edit.id !== id), { ...before, ...patch }];
      }),
  };
}

function changed(piece: PlannedSubChat, edit: SubChatEdit): SubChatEdit | null {
  const model = edit.model !== undefined && edit.model !== piece.model;
  const effort = edit.effort !== undefined && edit.effort !== piece.effort;
  if (!model && !effort) return null;
  return {
    id: edit.id,
    ...(model ? { model: edit.model } : {}),
    ...(effort ? { effort: edit.effort } : {}),
  };
}

export function subChatsPlanEdits(
  action: SparkAction,
  edits: readonly SubChatEdit[],
): Pick<SparkActionEdits, 'subChats'> {
  if (action.action !== 'start_sub_chats') return {};
  const subChats = action.pieces.flatMap((piece) => {
    const edit = edits.find((candidate) => candidate.id === piece.conversationId);
    const kept = edit ? changed(piece, edit) : null;
    return kept ? [kept] : [];
  });
  return subChats.length > 0 ? { subChats } : {};
}

function withCurrent(choices: PickerChoice[], current: string | null, label: string) {
  if (current === null || choices.some((choice) => choice.id === current)) return choices;
  return [...choices, { id: current, label }];
}

interface PieceProps {
  piece: PlannedSubChat;
  edit: SubChatEdit | undefined;
  disabled: boolean;
  onChange: (patch: Patch) => void;
}

function settingsOf(piece: PlannedSubChat, model: string): string {
  if (piece.sameAsParent) return 'Same as this chat';
  return [piece.agentName, model, piece.effort && `${piece.effort} effort`]
    .filter(Boolean)
    .join(' · ');
}

function PiecePickers({ piece, edit, disabled, onChange }: PieceProps) {
  const capabilities = useQuery({
    ...capabilitiesQuery(piece.provider),
    staleTime: CAPABILITIES_STALE_MS,
  });
  const model = edit?.model === undefined ? piece.model : edit.model;
  const effort = edit?.effort === undefined ? piece.effort : edit.effort;
  const options = capabilities.data?.models ?? [];
  const models = withCurrent(
    visibleModels(options, model, false, new Date()).map((option) => ({
      id: option.id,
      label: shortLabel(option.label),
    })),
    model,
    modelName(options, model),
  );
  const efforts = withCurrent(
    selectableEfforts(capabilities.data).map((option) => ({ id: option.id, label: option.label })),
    effort,
    effort ?? '',
  );
  return (
    <fieldset className="scplan-pick" disabled={disabled}>
      <legend className="sr-only">Model and effort for {piece.title}</legend>
      <ChoicePicker
        label={`Model for ${piece.title}`}
        choices={models}
        value={model ?? ''}
        placeholder="Default model"
        showNote={false}
        onChange={(id) => onChange({ model: id })}
      />
      {efforts.length > 0 && (
        <ChoicePicker
          label={`Effort for ${piece.title}`}
          choices={efforts}
          value={effort ?? ''}
          placeholder="Default effort"
          showNote={false}
          onChange={(id) => onChange({ effort: id })}
        />
      )}
    </fieldset>
  );
}

function PieceSettings({ piece, edit }: Pick<PieceProps, 'piece' | 'edit'>) {
  const capabilities = useQuery({
    ...capabilitiesQuery(piece.provider),
    staleTime: CAPABILITIES_STALE_MS,
  });
  const kept = edit ? changed(piece, edit) : null;
  const shown: PlannedSubChat = kept
    ? {
        ...piece,
        model: kept.model === undefined ? piece.model : kept.model,
        effort: kept.effort === undefined ? piece.effort : kept.effort,
        sameAsParent: false,
      }
    : piece;
  const model = modelName(capabilities.data?.models ?? [], shown.model);
  return <span className="scplan-set">{settingsOf(shown, model)}</span>;
}

interface SubChatsPlanFactsProps {
  action: StartSubChatsAction;
  plan: SubChatsPlanDraft;
  disabled: boolean;
}

export function SubChatsPlanFacts({ action, plan, disabled }: SubChatsPlanFactsProps) {
  const [tasksShown, setTasksShown] = useState(false);
  return (
    <div className="scplan">
      <ol className="scplan-list" aria-label="Sub-chats to start">
        {action.pieces.map((piece, index) => {
          const edit = plan.edits.find((candidate) => candidate.id === piece.conversationId);
          return (
            <li key={piece.conversationId}>
              <span className="scplan-n" aria-hidden="true">
                {index + 1}
              </span>
              <div className="scplan-main">
                <b>{piece.title}</b>
                <small>
                  {piece.project.name} · {subChatPlacement(piece, action.pieces)}
                </small>
                {tasksShown && <p className="scplan-task">{piece.task}</p>}
              </div>
              {plan.editing ? (
                <PiecePickers
                  piece={piece}
                  edit={edit}
                  disabled={disabled}
                  onChange={(patch) => plan.change(piece.conversationId, patch)}
                />
              ) : (
                <PieceSettings piece={piece} edit={edit} />
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="scplan-tasks"
        aria-expanded={tasksShown}
        onClick={() => setTasksShown((shown) => !shown)}
      >
        {tasksShown ? 'Hide each task' : 'Show each task ›'}
      </button>
    </div>
  );
}

export function subChatsByline(action: SparkAction, agent: string): string | null {
  if (action.action === 'stop_sub_chat') return `${agent} wants to stop a sub-chat’s turn.`;
  if (action.action !== 'start_sub_chats') return null;
  const count = action.pieces.length;
  return `${agent} wants to split this work into ${count === 1 ? 'a sub-chat' : `${count} sub-chats`}.`;
}

export function subChatsNote(action: SparkAction): string | null {
  if (action.action === 'stop_sub_chat') {
    return 'Nothing is stopped until you confirm. The sub-chat keeps its work and can go on later.';
  }
  if (action.action !== 'start_sub_chats') return null;
  return 'Nothing is created until you start it. Edit changes a piece’s model and effort. Each sub-chat gets its own worktree, branch and pull request, runs in a mode no higher than this chat’s, and its task is the agent’s text, not yours.';
}
