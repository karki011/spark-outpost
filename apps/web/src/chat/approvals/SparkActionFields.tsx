import { useId } from 'react';
import {
  editableFields,
  ticketPriorityNameSchema,
  ticketStatusLabels,
  ticketStatusSchema,
  type SparkAction,
  type SparkActionEdits,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';

export interface Draft {
  title: string;
  description: string;
  body: string;
  type: string | null;
  priority: string;
  labels: string;
  status: string;
  to: string;
  skip: string[];
}

const STATUS_CHOICES = ticketStatusSchema.options.map((status) => ({
  id: status,
  label: ticketStatusLabels[status],
}));

function nameChoices(action: SparkAction, current: string) {
  const names = action.action === 'transition_ticket' ? (action.choices ?? []) : [];
  return [...new Set([...names, current])].map((name) => ({ id: name, label: name }));
}

const PRIORITY_CHOICES = [
  { id: '', label: 'None' },
  ...ticketPriorityNameSchema.options.map((priority) => ({
    id: priority,
    label: priority[0]!.toUpperCase() + priority.slice(1),
  })),
];

const TEXT_LABELS: Partial<Record<SparkAction['action'], string>> = {
  comment_ticket: 'Comment',
  post_slack: 'Slack message',
};

export function draftOf(action: SparkAction): Draft {
  return {
    title: 'title' in action ? action.title : '',
    description: action.action === 'create_ticket' ? action.description : '',
    body: 'body' in action ? (action.body ?? '') : '',
    type: action.action === 'create_ticket' ? action.type : null,
    priority: action.action === 'create_ticket' ? (action.priority ?? '') : '',
    labels: action.action === 'create_ticket' ? action.labels.join(', ') : '',
    status: action.action === 'transition_ticket' ? action.status : '',
    to: action.action === 'transition_ticket' ? (action.to ?? '') : '',
    skip: action.action === 'pr_follow_up' ? action.skip : [],
  };
}

export function editsOf(action: SparkAction, draft: Draft): SparkActionEdits {
  const before = draftOf(action);
  const edits: SparkActionEdits = {};
  for (const field of editableFields(action.action)) {
    if (field === 'skip') {
      if (draft.skip.length > 0) edits.skip = draft.skip;
      continue;
    }
    if (draft[field] === before[field]) continue;
    if (field === 'labels') {
      edits.labels = draft.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
    } else if (field === 'priority') {
      edits.priority = ticketPriorityNameSchema.safeParse(draft.priority).data ?? null;
    } else if (field === 'status') {
      edits.status = ticketStatusSchema.parse(draft.status);
    } else if (field === 'type') {
      edits.type = draft.type?.trim() || null;
    } else {
      edits[field] = draft[field];
    }
  }
  return edits;
}

interface FieldsProps {
  action: SparkAction;
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
}

export function Fields({ action, draft, onChange, disabled }: FieldsProps) {
  const id = useId();
  const fields = editableFields(action.action);
  const set = (field: keyof Draft) => (value: string) => onChange({ ...draft, [field]: value });
  return (
    <div className="sac-fields">
      {fields.includes('title') && (
        <label className="field" htmlFor={`${id}-title`}>
          <span>Title</span>
          <input
            id={`${id}-title`}
            className="inp"
            value={draft.title}
            disabled={disabled}
            onChange={(event) => set('title')(event.target.value)}
          />
        </label>
      )}
      {(fields.includes('description') || fields.includes('body')) && (
        <label className="field" htmlFor={`${id}-text`}>
          <span>{TEXT_LABELS[action.action] ?? 'Description'}</span>
          <textarea
            id={`${id}-text`}
            className="inp"
            rows={5}
            value={fields.includes('body') ? draft.body : draft.description}
            disabled={disabled}
            onChange={(event) =>
              set(fields.includes('body') ? 'body' : 'description')(event.target.value)
            }
          />
        </label>
      )}
      {fields.includes('status') && (
        <div className="field">
          <span>Move to</span>
          {draft.to ? (
            <ChoicePicker
              label="Move to"
              choices={nameChoices(action, draft.to)}
              value={draft.to}
              onChange={set('to')}
            />
          ) : (
            <ChoicePicker
              label="Move to"
              choices={STATUS_CHOICES}
              value={draft.status}
              onChange={set('status')}
            />
          )}
        </div>
      )}
      {fields.includes('priority') && (
        <div className="sac-row">
          <label className="field" htmlFor={`${id}-type`}>
            <span>Type</span>
            <input
              id={`${id}-type`}
              className="inp"
              placeholder={
                action.action === 'create_ticket' && action.source === 'jira' ? 'Task' : 'None'
              }
              value={draft.type ?? ''}
              disabled={disabled}
              onChange={(event) => set('type')(event.target.value)}
            />
          </label>
          <div className="field">
            <span>Priority</span>
            <ChoicePicker
              label="Priority"
              choices={PRIORITY_CHOICES}
              value={draft.priority}
              onChange={set('priority')}
            />
          </div>
          <label className="field" htmlFor={`${id}-labels`}>
            <span>Labels</span>
            <input
              id={`${id}-labels`}
              className="inp"
              placeholder="Comma separated"
              value={draft.labels}
              disabled={disabled}
              onChange={(event) => set('labels')(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
