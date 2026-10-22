import '../tasks/task-list.css';
import './todo.css';
import { TaskStateIcon } from '../tasks/TaskIcons.tsx';
import type { TodoRow } from './todo-model.ts';

interface TodoListProps {
  rows: readonly TodoRow[];
  finished?: boolean;
  id?: string;
}

export function TodoList({ rows, finished = false, id }: TodoListProps) {
  return (
    <ol className="todo-list" id={id} aria-label="To-do items">
      {rows.map((row) => (
        <li key={row.id} data-state={row.state}>
          <TaskStateIcon
            state={row.state}
            {...(finished && row.state === 'pending' ? { label: 'Not finished' } : {})}
          />
          <span className="todo-label">{row.label}</span>
        </li>
      ))}
    </ol>
  );
}
