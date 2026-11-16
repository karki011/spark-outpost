import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import {
  HomeCard,
  HomeRow,
  HomeRows,
  Progress,
  Quiet,
  RowAction,
  RowsSkeleton,
  StatusLabel,
} from './HomeCards.tsx';
import type { ReviewItem } from './working-set-model.ts';
import type { RunItem } from './home-model.ts';

interface WorkingSetProps {
  running: readonly RunItem[];
  review: readonly ReviewItem[];
  loading: boolean;
  projectName: (chat: ConversationSummary) => string;
  onOpen: (chat: ConversationSummary) => void;
  onReview: (item: ReviewItem) => void;
}

function RunLabel({ item }: { item: RunItem }) {
  return (
    <span className="hrun">
      {item.provider && (
        <span className="hrun-b" aria-hidden="true">
          <AgentBlob provider={item.provider} size={18} expression="thinking" />
        </span>
      )}
      <StatusLabel word="Working" tone="run" />
    </span>
  );
}

export function WorkingSet({ running, review, loading, ...props }: WorkingSetProps) {
  const empty = running.length === 0 && review.length === 0;
  return (
    <HomeCard id="home-working" title="Working set" className="home-set">
      {empty ? (
        loading ? (
          <RowsSkeleton />
        ) : (
          <Quiet>Nothing is running. Finished chats show here until you open them.</Quiet>
        )
      ) : (
        <HomeRows label="Working set">
          {running.map((item, index) => (
            <HomeRow
              key={item.chat.id}
              index={index}
              label={<RunLabel item={item} />}
              title={item.chat.title}
              line={
                <>
                  <span className="pj">{props.projectName(item.chat)}</span>
                  {item.step}
                </>
              }
              trailing={
                <RowAction
                  label="Watch"
                  name={`Watch: ${item.chat.title}`}
                  onClick={() => props.onOpen(item.chat)}
                />
              }
            >
              <Progress percent={item.percent} />
            </HomeRow>
          ))}
          {review.map((item, index) => (
            <HomeRow
              key={item.chat.id}
              index={running.length + index}
              label={<StatusLabel word={item.clean ? 'Ready' : 'Done'} tone="ok" />}
              title={item.chat.title}
              line={item.line}
              trailing={
                <RowAction
                  label="Review"
                  name={`Review: ${item.chat.title}`}
                  onClick={() => props.onReview(item)}
                />
              }
            />
          ))}
        </HomeRows>
      )}
    </HomeCard>
  );
}
