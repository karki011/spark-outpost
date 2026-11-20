import './pr-card.css';
import { useQuery } from '@tanstack/react-query';
import type { PrWatch } from '@spark-outpost/contracts';
import { XIcon } from '../../ui/icons.tsx';
import { DockItem } from '../dock/DockItem.tsx';
import { useDismissed } from '../dock/use-dismissed.ts';
import { LineTotals } from '../changes/FileChangeList.tsx';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import {
  dismissKey,
  GROUP_OVER,
  PR_DISMISSED,
  groupLine,
  rowFacts,
  rowSummary,
  shownPulls,
} from './pr-card-model.ts';
import {
  lineChange,
  lineChangeLabel,
  PULL_STATE_LABELS,
  pullState,
  repoLabels,
} from './pull-request-model.ts';
import { CLEAN_LINE } from './post-open-model.ts';
import { PostOpenLines } from './PullOpenedLines.tsx';
import { PullPanel } from './PullPanel.tsx';
import { RefreshPullButton } from './RefreshPullButton.tsx';
import { usePullRefresh } from './use-pull-refresh.ts';
import { useWatchContext, type WatchContext } from './use-watch-context.ts';
import { watchIndicator, watchLabel } from './watch-indicator-model.ts';
import { WatchMark } from './WatchIndicator.tsx';

interface PrRowProps {
  watch: PrWatch;
  repo: string;
  nested?: boolean;
  context: WatchContext;
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
  onOpenLinks: (() => void) | null;
}

function PrRow(props: PrRowProps) {
  const { watch, context, dismissed, onDismiss } = props;
  return (
    <>
      <PrRowItem {...props} />
      {watch.opened.runId === null && (
        <PostOpenLines
          watches={[watch]}
          mode={context.mode}
          dismissed={dismissed}
          onDismiss={onDismiss}
        />
      )}
    </>
  );
}

function PrRowItem({ watch, repo, nested = false, context, onDismiss, onOpenLinks }: PrRowProps) {
  const state = pullState(watch);
  const lines = lineChange(watch);
  const refresh = usePullRefresh(watch);
  const indicator = watchIndicator(watch, context.contextFor(watch.roundRunId));
  const name = `Pull request ${watch.repo}#${watch.number}`;
  return (
    <DockItem
      icon={<PullRequestIcon />}
      className={`prc-item ${state}${nested ? ' nested' : ''}`}
      label={name}
      toggleLabel={`${name} details`}
      row={
        <>
          <a className="prc-num" href={watch.url} target="_blank" rel="noopener noreferrer">
            #{watch.number}
          </a>
          <span className="prc-repo" title={watch.title ?? undefined}>
            {repo}
          </span>
          {watch.title && <span className="sr-only">{watch.title}</span>}
          <span className="prc-lines" title={watch.title ?? undefined}>
            {lines && (
              <>
                <span aria-hidden="true">
                  <LineTotals added={lines.added} removed={lines.removed} />
                </span>
                <span className="sr-only">{lineChangeLabel(lines)}</span>
              </>
            )}
          </span>
          <span className="prc-facts">
            {rowFacts(watch).map((fact) => (
              <span key={`${fact.key} ${fact.text}`} className={`prc-fact ${fact.tone}`}>
                {fact.text}
              </span>
            ))}
          </span>
          {indicator && <WatchMark indicator={indicator} />}
          <span key={state} className={`prc-state ${state}`}>
            {PULL_STATE_LABELS[state]}
          </span>
        </>
      }
      note={refresh.problem}
      status={watch.clean ? CLEAN_LINE : null}
      trailing={
        <>
          <RefreshPullButton number={watch.number} refresh={refresh} />
          {watch.prState !== 'open' && (
            <button
              type="button"
              className="prc-x"
              aria-label={`Dismiss pull request #${watch.number}`}
              onClick={() => onDismiss(dismissKey(watch))}
            >
              <XIcon />
            </button>
          )}
        </>
      }
      panel={
        <PullPanel
          watch={watch}
          indicator={indicator}
          profile={context.profile}
          onOpenLinks={onOpenLinks}
        />
      }
    />
  );
}

function announced(watch: PrWatch, mode: WatchContext['mode']): string {
  const clean = watch.clean ? CLEAN_LINE : '';
  return [rowSummary(watch), watchLabel(watch, mode), clean].filter(Boolean).join(', ');
}

interface PrCardProps {
  conversationId: string;
  onOpenLinks: (() => void) | null;
}

export function PrCard({ conversationId, onOpenLinks }: PrCardProps) {
  const watches = useQuery(prWatchesQuery(conversationId)).data?.watches;
  const [dismissed, dismiss] = useDismissed(PR_DISMISSED, conversationId);
  const shown = shownPulls(watches ?? [], dismissed);
  if (shown.length === 0) return null;
  return (
    <PrRows
      conversationId={conversationId}
      shown={shown}
      dismissed={dismissed}
      onDismiss={dismiss}
      onOpenLinks={onOpenLinks}
    />
  );
}

interface PrRowsProps extends PrCardProps {
  shown: readonly PrWatch[];
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
}

function PrRows({ conversationId, shown, dismissed, onDismiss, onOpenLinks }: PrRowsProps) {
  const context = useWatchContext(conversationId);
  const grouped = shown.length > GROUP_OVER;
  const count = `${shown.length} pull requests`;
  const line = grouped ? groupLine(shown) : '';
  const repos = repoLabels(shown);
  return (
    <section className="prc" aria-label="PR status">
      <p className="sr-only" role="status">
        {grouped ? `${count}${line ? `: ${line}` : ''}` : announced(shown[0]!, context.mode)}
      </p>
      {grouped ? (
        <DockItem
          icon={<PullRequestIcon />}
          className="prc-item group"
          label={count}
          toggleLabel={`${count}, details`}
          row={
            <>
              <span className="prc-title">{count}</span>
              <span className="prc-facts">
                <span key={line} className="prc-fact plain">
                  {line}
                </span>
              </span>
            </>
          }
          panel={shown.map((watch) => (
            <PrRow
              key={watch.id}
              watch={watch}
              repo={repos.get(watch.repo) ?? watch.repo}
              nested
              context={context}
              dismissed={dismissed}
              onDismiss={onDismiss}
              onOpenLinks={onOpenLinks}
            />
          ))}
        />
      ) : (
        shown.map((watch) => (
          <PrRow
            key={watch.id}
            watch={watch}
            repo={repos.get(watch.repo) ?? watch.repo}
            context={context}
            dismissed={dismissed}
            onDismiss={onDismiss}
            onOpenLinks={onOpenLinks}
          />
        ))
      )}
    </section>
  );
}
