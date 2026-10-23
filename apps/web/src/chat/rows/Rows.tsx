import './rows.css';
import { Fragment, use, useId, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronIcon, PauseIcon, XIcon } from '../../ui/icons.tsx';
import { Counts } from '../changes/FileChangeList.tsx';
import { CommandTerminal } from '../commands/CommandTerminal.tsx';
import { CommandUiContext, shownBefore } from '../commands/command-ui.ts';
import { StepThought } from '../StepThought.tsx';
import type { CommandAnswers } from '../commands/command-answers.ts';
import {
  failedCount,
  groupCommands,
  groupSeconds,
  groupWords,
  onlyEdits,
  type GroupKind,
} from './group-summary.ts';
import { RowIcon, type RowIconName } from './RowIcon.tsx';
import {
  spanSeconds,
  type CommandItem,
  type GroupedItem,
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
  answers: CommandAnswers;
}

const TONE_ICONS: Record<ToolItem['tone'], RowIconName> = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  run: 'run',
  web: 'web',
  other: 'other',
};

const KIND_ICONS: Record<GroupKind, RowIconName> = {
  run: 'run',
  edit: 'edit',
  read: 'read',
  search: 'search',
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
  const where = item.path ?? item.target;
  const entry = where ? (context.changes?.entry(where) ?? null) : null;
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

function countOf(items: readonly CommandItem[], status: CommandItem['command']['status']) {
  return items.filter((item) => item.command.status === status).length;
}

function statusWords(group: RowGroup, answers: CommandAnswers) {
  const isDenied = (item: CommandItem) =>
    answers.get(item.command.toolCallId ?? '')?.denied === true;
  const all = groupCommands(group);
  const commands = all.filter((item) => !isDenied(item));
  const deniedFailed = all.filter(
    (item) => isDenied(item) && item.command.status === 'failed',
  ).length;
  const words = [
    { count: failedCount(group) - deniedFailed, word: 'failed', tone: 'bad', icon: <XIcon /> },
    { count: all.length - commands.length, word: 'denied', tone: 'bad', icon: <XIcon /> },
    { count: countOf(commands, 'interrupted'), word: 'interrupted', tone: '', icon: <PauseIcon /> },
    {
      count: countOf(commands, 'completed'),
      word: 'passed',
      tone: 'ok',
      icon: <CheckIcon className="ok" />,
    },
  ].filter((shown) => shown.count > 0);
  return words.map((shown, index) => (
    <Fragment key={shown.word}>
      {index > 0 && <span aria-hidden="true">·</span>}
      <span className={`trow-word ${shown.tone}`.trim()}>
        {shown.icon}
        {shown.count} {shown.word}
      </span>
    </Fragment>
  ));
}

function needsLook(item: GroupedItem): boolean {
  if (item.kind === 'tool') return item.status === 'failed';
  if (item.kind !== 'command') return false;
  return item.command.status === 'failed' || item.command.status === 'interrupted';
}

function groupCounts(group: RowGroup, changes: TurnChanges | null) {
  if (!onlyEdits(group) || !changes) return null;
  const entries = group.items.flatMap((item) => {
    const where = item.kind === 'tool' ? (item.path ?? item.target) : null;
    return where ? [changes.entry(where)] : [];
  });
  if (entries.some((entry) => entry === null || entry.added === null)) return null;
  const files = [...new Set(entries)];
  const added = files.reduce((sum, entry) => sum + (entry?.added ?? 0), 0);
  const removed = files.reduce((sum, entry) => sum + (entry?.removed ?? 0), 0);
  return <Counts added={added} removed={removed} />;
}

function GroupEnd({ group, context }: { group: RowGroup; context: RowContext }) {
  const { changes } = context;
  const words = statusWords(group, context.answers);
  const seconds = failedCount(group) > 0 ? null : groupSeconds(group);
  return (
    <>
      {words}
      {groupCounts(group, changes)}
      {seconds && (
        <span className="trow-time">
          {words.length > 0 && <span aria-hidden="true">· </span>}
          {seconds}s
        </span>
      )}
    </>
  );
}

function GroupRow({ group, context }: { group: RowGroup; context: RowContext }) {
  const remembered = use(CommandUiContext);
  const attention = group.items.some(
    (item) =>
      needsLook(item) || (item.kind === 'command' && shownBefore(remembered, item.command.id)),
  );
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? attention;
  const id = useId();
  const words = groupWords(group);
  return (
    <>
      <button
        type="button"
        className="trow trow-group"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setChoice(!open)}
      >
        <RowIcon name={KIND_ICONS[words.kind]} />
        <span className="trow-text">
          <b>{words.lead}</b>
          {words.rest}
        </span>
        <span className="trow-end">
          <GroupEnd group={group} context={context} />
          <ChevronIcon />
        </span>
      </button>
      <div className="trow-nest" id={id} hidden={!open}>
        {open && group.items.map((item) => <RowView key={item.key} row={item} context={context} />)}
      </div>
      {group.live && (
        <div className="trow-nest trow-live">
          <RowView row={group.live} context={context} />
        </div>
      )}
    </>
  );
}

export function RowView({ row, context }: { row: Row; context: RowContext }) {
  if (row.kind === 'group') return <GroupRow group={row} context={context} />;
  if (row.kind === 'thought') return <ThoughtRow item={row} context={context} />;
  if (row.kind === 'todo') return context.todo;
  if (row.kind === 'command') {
    const answer = context.answers.get(row.command.toolCallId ?? '') ?? null;
    return <CommandTerminal command={row.command} waiting={context.waiting} answer={answer} />;
  }
  return <ToolRow item={row} context={context} />;
}
