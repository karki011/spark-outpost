import './rows.css';
import { useId, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronIcon, XIcon } from '../../ui/icons.tsx';
import { Counts } from '../changes/FileChangeList.tsx';
import { CommandTerminal } from '../commands/CommandTerminal.tsx';
import { StepThought } from '../StepThought.tsx';
import { RowIcon, type RowIconName } from './RowIcon.tsx';
import {
  groupSummary,
  groupVerb,
  spanSeconds,
  type CommandItem,
  type Row,
  type RowGroup,
  type ThoughtItem,
  type ToolItem,
} from './turn-rows.ts';
import type { TurnChanges } from './use-turn-changes.ts';

export interface RowContext {
  runId: string | null;
  working: boolean;
  waiting: boolean;
  changes: TurnChanges | null;
  todo: ReactNode;
}

const TONE_ICONS: Record<ToolItem['tone'], RowIconName> = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  run: 'run',
  web: 'web',
  other: 'other',
};

const FAMILY_ICONS: Record<RowGroup['family'], RowIconName> = {
  explore: 'search',
  edit: 'edit',
  run: 'run',
};

export function Spinner() {
  return <span className="spin trow-spin" role="img" aria-label="In progress" />;
}

function ToolEnd({ item, live }: { item: ToolItem; live: boolean }) {
  if (item.status === 'failed') {
    return (
      <span className="trow-word bad">
        <XIcon />
        failed
      </span>
    );
  }
  if (item.status === 'open') return live ? <Spinner /> : null;
  return null;
}

function RowText({ verb, target, code }: { verb: string; target: string | null; code: boolean }) {
  return (
    <span className="trow-text">
      <b>{verb}</b>
      {target && (code ? <code className="trow-target">{target}</code> : <span> {target}</span>)}
    </span>
  );
}

function EditRow({ item, context }: { item: ToolItem; context: RowContext }) {
  const entry = item.target ? (context.changes?.entry(item.target) ?? null) : null;
  const open = context.changes?.open;
  const body = (
    <>
      <RowIcon name="edit" />
      <RowText verb={item.verb} target={item.target} code />
      <span className="trow-end">
        {entry && <Counts added={entry.added} removed={entry.removed} />}
        <ToolEnd item={item} live={context.working} />
        {open && <ChevronIcon />}
      </span>
    </>
  );
  if (!open || item.status === 'open') {
    return (
      <div className="trow" title={item.label}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="trow"
      title={item.label}
      aria-label={`${item.verb} ${item.target ?? ''}: open in Changes`}
      onClick={() => open(entry ?? undefined)}
    >
      {body}
    </button>
  );
}

function ToolRow({ item, context }: { item: ToolItem; context: RowContext }) {
  if (item.tone === 'edit') return <EditRow item={item} context={context} />;
  const code = item.tone === 'read' || item.tone === 'run';
  return (
    <div className="trow" title={item.label}>
      <RowIcon name={TONE_ICONS[item.tone]} />
      <RowText verb={item.verb} target={item.target} code={code} />
      <span className="trow-end">
        <ToolEnd item={item} live={context.working} />
      </span>
    </div>
  );
}

function thoughtLabel(item: ThoughtItem, live: boolean): string {
  if (item.step.status === 'open' && live) return 'Thinking';
  const seconds = spanSeconds([item.step]);
  return seconds ? `Thought for ${seconds}s` : 'Thought';
}

function ThoughtRow({ item, context }: { item: ThoughtItem; context: RowContext }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const live = context.working && item.step.status === 'open';
  const label = thoughtLabel(item, context.working);
  const readable = Boolean(item.step.reasoningId && context.runId);
  if (!readable) {
    return (
      <div className="trow quiet">
        <RowIcon name="think" />
        <span className="trow-text">{label}</span>
        <span className="trow-end">{live && <Spinner />}</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="trow quiet"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <RowIcon name="think" />
        <span className="trow-text">{label}</span>
        <ChevronIcon />
        <span className="trow-end">{live && <Spinner />}</span>
      </button>
      {open && (
        <div className="trow-nest">
          <StepThought
            id={id}
            runId={context.runId!}
            reasoningId={item.step.reasoningId!}
            live={item.step.thought}
            streaming={live}
          />
        </div>
      )}
    </>
  );
}

function commandsEnd(items: readonly CommandItem[]) {
  const failed = items.filter((item) => item.command.status === 'failed').length;
  const passed = items.filter((item) => item.command.status === 'completed').length;
  return (
    <>
      {failed > 0 && (
        <span className="trow-word bad">
          <XIcon />
          {failed} failed
        </span>
      )}
      {failed > 0 && passed > 0 && <span aria-hidden="true">·</span>}
      {passed > 0 && (
        <span className="trow-word ok">
          <CheckIcon className="ok" />
          {passed} passed
        </span>
      )}
    </>
  );
}

function groupCounts(group: RowGroup, changes: TurnChanges | null) {
  if (group.family !== 'edit' || !changes) return null;
  const entries = group.items.flatMap((item) =>
    item.kind === 'tool' && item.target ? [changes.entry(item.target)] : [],
  );
  if (entries.some((entry) => entry === null || entry.added === null)) return null;
  const added = entries.reduce((sum, entry) => sum + (entry?.added ?? 0), 0);
  const removed = entries.reduce((sum, entry) => sum + (entry?.removed ?? 0), 0);
  return <Counts added={added} removed={removed} />;
}

function GroupEnd({ group, changes }: { group: RowGroup; changes: TurnChanges | null }) {
  if (group.family === 'run') {
    return commandsEnd(group.items.filter((item): item is CommandItem => item.kind === 'command'));
  }
  if (group.family === 'edit') return groupCounts(group, changes);
  const seconds = spanSeconds(group.items.filter((item): item is ToolItem => item.kind === 'tool'));
  return seconds ? <span className="trow-time">{seconds}s</span> : null;
}

function GroupRow({ group, context }: { group: RowGroup; context: RowContext }) {
  const failed = group.items.some(
    (item) => item.kind === 'command' && item.command.status === 'failed',
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? failed;
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="trow"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChoice(!open)}
      >
        <RowIcon name={FAMILY_ICONS[group.family]} />
        <span className="trow-text">
          <b>{groupVerb(group.family)}</b> {groupSummary(group)}
        </span>
        <span className="trow-end">
          <GroupEnd group={group} changes={context.changes} />
          <ChevronIcon />
        </span>
      </button>
      <div className="trow-nest" id={id} hidden={!open}>
        {open && group.items.map((item) => <RowView key={item.key} row={item} context={context} />)}
      </div>
    </>
  );
}

export function RowView({ row, context }: { row: Row; context: RowContext }) {
  if (row.kind === 'group') return <GroupRow group={row} context={context} />;
  if (row.kind === 'thought') return <ThoughtRow item={row} context={context} />;
  if (row.kind === 'todo') return context.todo;
  if (row.kind === 'command') {
    return <CommandTerminal command={row.command} waiting={context.waiting} />;
  }
  return <ToolRow item={row} context={context} />;
}
