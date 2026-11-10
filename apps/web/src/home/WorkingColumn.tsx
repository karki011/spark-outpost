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
import type { RunItem } from './home-model.ts';
import type { ReviewItem } from './board-model.ts';
import { SparksLine } from './SparksLine.tsx';

type OpenChat = (chat: ConversationSummary) => void;

interface WorkingColumnProps {
  running: readonly RunItem[];
  review: readonly ReviewItem[];
  loading: boolean;
  now: number;
  projectName: (chat: ConversationSummary) => string;
  onOpen: OpenChat;
  onReview: (item: ReviewItem) => void;
  onOpenId: (conversationId: string) => void;
}

function RunLabel({ item }: { item: RunItem }) {
  return (
    <span className="hrun">
      {item.provider && (
        <span className="hrun-b" aria-hidden="true">
          <AgentBlob provider={item.provider} size={18} expression="thinking" />
        </span>
      )}
      <StatusLabel word="Running" tone="run" />
    </span>
  );
}

export function WorkingColumn(props: WorkingColumnProps) {
  const { running, review } = props;
  return (
    <div className="hcol">
      <HomeCard id="home-working" title="Working" count={running.length}>
        {running.length === 0 ? (
          props.loading ? (
            <RowsSkeleton />
          ) : (
            <Quiet>Nothing is running right now.</Quiet>
          )
        ) : (
          <HomeRows label="Working chats">
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
          </HomeRows>
        )}
      </HomeCard>
      {review.length > 0 && (
        <HomeCard id="home-review" title="Ready for you to review" count={review.length}>
          <HomeRows label="Ready for you to review">
            {review.map((item, index) => (
              <HomeRow
                key={item.chat.id}
                index={index}
                label={<StatusLabel word={item.clean ? 'Ready to merge' : 'Finished'} tone="ok" />}
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
        </HomeCard>
      )}
      <SparksLine now={props.now} onOpenId={props.onOpenId} />
    </div>
  );
}
