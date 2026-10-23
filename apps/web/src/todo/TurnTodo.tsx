import { useId, useState } from 'react';
import type { PlanEntry } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { RowIcon } from '../chat/rows/RowIcon.tsx';
import { TodoList } from './TodoList.tsx';
import { doneCount, finishedText, todoRows } from './todo-model.ts';

interface TurnTodoProps {
  entries: readonly PlanEntry[];
  live: boolean;
}

function LiveTodo({ entries }: { entries: readonly PlanEntry[] }) {
  return (
    <section className="todo-card" aria-label="This turn's to-do">
      <div className="todo-head trow">
        <RowIcon name="todo" />
        <b>To-do</b>
        <span className="todo-count" aria-live="polite">
          {doneCount(entries)} of {entries.length}
          <span className="sr-only"> done</span>
        </span>
      </div>
      <TodoList rows={todoRows(entries, true)} />
    </section>
  );
}

function FinishedTodo({ entries }: { entries: readonly PlanEntry[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const text = finishedText(entries);
  return (
    <div className={open ? 'todo-done open' : 'todo-done'}>
      <button
        type="button"
        className="todo-line trow"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`To-do: ${text}`}
        onClick={() => setOpen(!open)}
      >
        <RowIcon name="todo" />
        <span className="trow-text">
          <b>To-do</b> {text}
        </span>
        <ChevronIcon />
      </button>
      {open && <TodoList rows={todoRows(entries, false)} finished id={listId} />}
    </div>
  );
}

export function TurnTodo({ entries, live }: TurnTodoProps) {
  if (entries.length === 0) return null;
  return live ? <LiveTodo entries={entries} /> : <FinishedTodo entries={entries} />;
}
