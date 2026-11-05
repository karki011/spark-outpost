import type { TaskDetail, TaskListItem } from '@spark-outpost/contracts';
import { TodoList } from '../todo/TodoList.tsx';
import { TodoHistory } from './TodoHistory.tsx';
import { TaskList } from './TaskList.tsx';
import { usePaneId } from '../chat/split/chat-pane.ts';

interface TodoPaneProps {
  taskId: string;
  todo: readonly TaskListItem[];
  recorded: readonly TaskListItem[];
  detail: TaskDetail | undefined;
  roots: readonly string[];
}

export function TodoPane({ taskId, todo, recorded, detail, roots }: TodoPaneProps) {
  const handled = recorded.filter((item) => item.state !== 'waiting');
  const todoHeading = usePaneId('todo-pane-h');
  const recordedHeading = usePaneId('recorded-pane-h');
  return (
    <>
      {todo.length > 0 && (
        <section className="wsec" aria-labelledby={todoHeading}>
          <div className="wsec-h">
            <h3 id={todoHeading}>Latest list</h3>
            <span>as the agent sent it</span>
          </div>
          <TodoList rows={todo} />
          {detail && (
            <TodoHistory taskId={taskId} versions={detail.planVersions} runs={detail.runs} />
          )}
        </section>
      )}
      {handled.length > 0 && (
        <section className="wsec" aria-labelledby={recordedHeading}>
          <div className="wsec-h">
            <h3 id={recordedHeading}>Recorded by Spark</h3>
            <span>approvals and actions Spark handled</span>
          </div>
          <TaskList items={handled} roots={roots} />
        </section>
      )}
    </>
  );
}
