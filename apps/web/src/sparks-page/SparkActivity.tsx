import type { SparkActivityKind, SparkUsage, UsageTotals } from '@spark-outpost/contracts';
import { requestChat } from '../app/chat-request.ts';
import { CommentIcon, SparkleIcon, WarnIcon, WorkflowIcon } from '../ui/icons.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { activityLine, countLabel, totalsLine } from './spark-usage-model.ts';
import { useSparkUsage } from './use-spark-save.ts';

const KINDS: readonly SparkActivityKind[] = ['chat', 'job', 'step'];

function KindIcon({ kind }: { kind: SparkActivityKind }) {
  if (kind === 'chat') return <CommentIcon />;
  return kind === 'job' ? <SparkleIcon /> : <WorkflowIcon />;
}

function totalsOf(usage: SparkUsage, kind: SparkActivityKind): UsageTotals {
  if (kind === 'chat') return usage.chats;
  return kind === 'job' ? usage.jobs : usage.steps;
}

export function SparkActivity({ sparkId }: { sparkId: string }) {
  const usage = useSparkUsage(sparkId);
  const now = useMinuteClock();
  if (usage.isPending) {
    return <Skeleton label="Loading this Spark’s activity" shape="list" rows={4} />;
  }
  if (usage.isError) {
    return (
      <p className="spk-problem" role="alert">
        <WarnIcon /> Couldn’t load this Spark’s activity. {usage.error.message}
      </p>
    );
  }
  const { recent } = usage.data;
  return (
    <div className="spk-activity">
      <ul className="spk-totals" aria-label="How this Spark has been used">
        {KINDS.map((kind) => {
          const totals = totalsOf(usage.data, kind);
          return (
            <li key={kind} className="spk-box spk-total">
              <span className="spk-total-kind">
                <KindIcon kind={kind} /> {countLabel(kind, totals.count)}
              </span>
              <small>{totalsLine(totals, now)}</small>
            </li>
          );
        })}
      </ul>
      <section className="spk-box" aria-label="Recent activity">
        <h2>Recent</h2>
        {recent.length === 0 ? (
          <p className="spk-hint">
            Nothing yet. Chats with this Spark, @ jobs and workflow steps show here.
          </p>
        ) : (
          <ul className="spk-rows">
            {recent.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="spk-row">
                <span className="spk-row-icon">
                  <KindIcon kind={entry.kind} />
                </span>
                <span className="spk-row-text">
                  <b>{entry.title}</b>
                  <small>{activityLine(entry, now)}</small>
                </span>
                {entry.conversationId && (
                  <button
                    type="button"
                    className="btn ghost sm spk-row-open"
                    aria-label={`Open the chat ${entry.title}`}
                    onClick={() => requestChat(entry.conversationId!)}
                  >
                    Open chat
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
