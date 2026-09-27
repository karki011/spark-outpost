import './digest.css';
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, Digest, DigestSuggestion } from '@spark-outpost/contracts';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { BlobScout } from '../brand/BlobScout.tsx';
import { scrollToAnchor } from '../crew/scroll-to-anchor.ts';
import { readDetailsOpen, writeDetailsOpen } from './digest-details.ts';
import { homeApi, homeKeys } from './home-api.ts';
import { HomeSection } from './HomeCards.tsx';
import {
  canRefresh,
  digestChips,
  digestMeta,
  digestView,
  refreshHint,
  type DigestChip,
} from './digest-model.ts';

interface DigestCardProps {
  chats: readonly ConversationSummary[];
  now: number;
  onOpenChat: (chatId: string) => void;
  onContinue: (suggestion: DigestSuggestion) => void;
}

function Lines({ digest, onOpenChat }: { digest: Digest; onOpenChat: (id: string) => void }) {
  const lines = digest.body?.lines ?? [];
  if (lines.length === 0) return <p className="hnote">The digest came back empty.</p>;
  return (
    <ul className="dg-lines">
      {lines.map((line, index) => (
        <li key={index}>
          {line.chatId ? (
            <button type="button" className="dg-line" onClick={() => onOpenChat(line.chatId!)}>
              {line.text}
            </button>
          ) : (
            <span className="dg-line">{line.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface SuggestionsProps {
  suggestions: readonly DigestSuggestion[];
  titleOf: (id: string) => string;
  onContinue: (suggestion: DigestSuggestion) => void;
}

function Suggestions({ suggestions, titleOf, onContinue }: SuggestionsProps) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="dg-next" aria-label="Pick up where you left off">
      {suggestions.map((suggestion) => (
        <li key={suggestion.chatId}>
          <span className="dg-next-main">
            <b>{titleOf(suggestion.chatId)}</b>
            <small>{suggestion.reason}</small>
          </span>
          <button
            type="button"
            className="btn sm line"
            aria-label={`Continue ${titleOf(suggestion.chatId)}`}
            onClick={() => onContinue(suggestion)}
          >
            Continue
          </button>
        </li>
      ))}
    </ul>
  );
}

function Writing() {
  return (
    <div className="dg-skel" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function Chips({ chips }: { chips: readonly DigestChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="dg-chips">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button type="button" className="dg-chip" onClick={() => scrollToAnchor(chip.section)}>
            {chip.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface OverviewProps {
  digest: Digest;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

function Overview({ digest, detailsOpen, onToggleDetails }: OverviewProps) {
  const headline = digest.body?.headline;
  if (!headline) return null;
  return (
    <div className="dg-overview">
      <p className="dg-headline">{headline}</p>
      <Chips chips={digestChips(digest.stats)} />
      <button
        type="button"
        className="hlink dg-toggle"
        aria-expanded={detailsOpen}
        aria-controls="digest-details"
        onClick={onToggleDetails}
      >
        {detailsOpen ? 'Hide details' : 'Show details'}
      </button>
    </div>
  );
}

export function DigestCard({ chats, now, onOpenChat, onContinue }: DigestCardProps) {
  const queryClient = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(readDetailsOpen);
  const digest = useQuery({
    queryKey: homeKeys.digest,
    queryFn: homeApi.digest,
  });
  const ask = useMutation({
    mutationFn: homeApi.requestDigest,
    onSuccess: (state) => queryClient.setQueryData(homeKeys.digest, state),
  });
  const askDigest = ask.mutate;

  useEffect(() => {
    askDigest('open');
  }, [askDigest]);

  const state = digest.data;
  const view = digestView(state);
  if (view === 'hidden') return null;
  const current = state?.digest ?? null;
  const writing = view === 'writing' || ask.isPending;
  const titleOf = (id: string) => chats.find((chat) => chat.id === id)?.title ?? 'This chat';
  const hint = refreshHint(state, now);
  const toggleDetails = () => {
    setDetailsOpen((open) => {
      const next = !open;
      writeDetailsOpen(next);
      return next;
    });
  };

  return (
    <HomeSection
      id="home-digest"
      title="Digest"
      className="hdigest"
      action={
        <button
          type="button"
          className="hlink"
          disabled={writing || !canRefresh(state, now)}
          title={hint ?? undefined}
          onClick={() => ask.mutate('refresh')}
        >
          {writing ? 'Writing…' : 'Refresh'}
        </button>
      }
    >
      <div className="hpanel dg" aria-busy={writing}>
        <div className="dg-head">
          <BlobScout size={28} mood={writing ? 'working' : null} />
          <p className="dg-meta" aria-live="polite">
            {writing
              ? 'Reading your recent work…'
              : current && view !== 'quiet'
                ? digestMeta(current)
                : 'Nothing new since your last digest.'}
          </p>
          {current?.conversationId && !writing && view === 'ready' && (
            <button type="button" className="hlink" onClick={() => setAuditOpen(true)}>
              Audit
            </button>
          )}
        </div>
        {writing && <Writing />}
        {!writing && view === 'failed' && (
          <p className="dg-error" role="status">
            {current?.error ?? 'The digest could not be written.'}{' '}
            {canRefresh(state, now) ? (
              <button type="button" className="hlink" onClick={() => ask.mutate('refresh')}>
                Retry
              </button>
            ) : (
              hint && <span className="dg-hint">{hint}.</span>
            )}
          </p>
        )}
        {!writing && view === 'ready' && current && (
          <>
            <Overview digest={current} detailsOpen={detailsOpen} onToggleDetails={toggleDetails} />
            {detailsOpen && (
              <div id="digest-details">
                <Lines digest={current} onOpenChat={onOpenChat} />
                <Suggestions
                  suggestions={current.body?.suggestions ?? []}
                  titleOf={titleOf}
                  onContinue={onContinue}
                />
                {!state?.newActivity && <p className="hnote">Nothing new since this digest.</p>}
              </div>
            )}
          </>
        )}
        {ask.isError && <p className="home-error">{ask.error.message}</p>}
      </div>
      <AnimatePresence>
        {auditOpen && current?.conversationId && (
          <AuditDialog
            conversationId={current.conversationId}
            title="Digest"
            onClose={() => setAuditOpen(false)}
          />
        )}
      </AnimatePresence>
    </HomeSection>
  );
}
