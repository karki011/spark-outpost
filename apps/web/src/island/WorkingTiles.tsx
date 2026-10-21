import type { RunningRow } from './inbox-model.ts';
import { shortAgo } from './inbox-model.ts';
import { SessionBlob } from './SessionBlob.tsx';
import { SpinnerIcon } from '../ui/icons.tsx';

interface WorkingTilesProps {
  rows: readonly RunningRow[];
  now: number;
  onOpenChat: (chatId: string) => void;
}

export function WorkingTiles({ rows, now, onOpenChat }: WorkingTilesProps) {
  if (rows.length === 0) return null;
  return (
    <section className="isl-working" aria-labelledby="isl-working-h">
      <h3 id="isl-working-h">
        Working <span aria-hidden="true">· {rows.length}</span>
      </h3>
      <ul>
        {rows.map(({ chat, detail }) => (
          <li key={chat.id}>
            <button
              type="button"
              className="isl-work-tile"
              title={`Open ${chat.title} in Spark`}
              onClick={() => onOpenChat(chat.id)}
            >
              <SessionBlob chat={chat} state="working" size={30} />
              <span className="isl-work-text">
                <b>{chat.title}</b>
                <span>
                  {detail} · {shortAgo(chat.updatedAt, now)}
                </span>
              </span>
              <span className="isl-work-spin" aria-hidden="true">
                <SpinnerIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
