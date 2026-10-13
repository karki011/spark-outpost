import type { ConversationSummary } from '@spark-outpost/contracts';
import { pagerLabel } from './session-summary.ts';

interface NowPagerProps {
  sessions: readonly ConversationSummary[];
  index: number;
  onShow: (index: number) => void;
}

export function NowPager({ sessions, index, onShow }: NowPagerProps) {
  if (sessions.length < 2) return null;
  const place = pagerLabel(index, sessions.length);
  return (
    <div
      className="isl-dots"
      role="group"
      aria-label={`Live chats, ${place}`}
      title="Swipe or scroll sideways to see the other chats"
    >
      {sessions.map((item, at) => (
        <button
          key={item.id}
          type="button"
          aria-label={`Show ${item.title}`}
          title={item.title}
          aria-current={at === index || undefined}
          onClick={() => onShow(at)}
        />
      ))}
      <span className="isl-dots-place" aria-hidden="true">
        {place}
      </span>
    </div>
  );
}
