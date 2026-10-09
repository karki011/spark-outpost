import './story-bar.css';
import type { OutpostStory } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { StoryRow } from './StoryRow.tsx';
import { storyBarView } from './story-bar.ts';

interface StoryBarProps {
  stories: readonly OutpostStory[];
  onOpenChat: (conversationId: string) => void;
  onFill: (text: string) => void;
}

export function StoryBar({ stories, onOpenChat, onFill }: StoryBarProps) {
  if (stories.length === 0) return null;
  return (
    <section className="op-stories" aria-label="Stories">
      {stories.map((story, index) => {
        const view = storyBarView(story, index);
        return (
          <details key={view.key} className="op-story">
            <summary>
              <ChevronIcon />
              <span className="op-story-kind">Story</span>
              <b>{view.title}</b>
              <span className="op-story-summary">{view.summary}</span>
            </summary>
            <ol className="op-story-rows" aria-label={`Sub-tasks of ${view.title}`}>
              {view.rows.map((row) => (
                <StoryRow
                  key={row.conversationId}
                  row={row}
                  onOpenChat={onOpenChat}
                  onFill={onFill}
                />
              ))}
            </ol>
          </details>
        );
      })}
    </section>
  );
}
