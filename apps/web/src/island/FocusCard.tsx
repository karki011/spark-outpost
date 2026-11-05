import { useEffect, useRef, type RefObject } from 'react';
import type { ApprovalOption } from '@spark-outpost/contracts';
import { isCheckpoint } from '../chat/checkpoints/checkpoint-model.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { askedPrompt, pickDecision } from './asked-question.ts';
import { cardHeading, QuestionChoices, Target } from './CardView.tsx';
import { answerable, cardLine } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { Kbd, useArmed } from './island-parts.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { findOption, useDecide, type Decided } from './use-decide.ts';

export interface FocusCardProps {
  card: Card;
  agent: string;
  project: string | null;
  seen: boolean;
  index: number;
  total: number;
  onPage: (index: number) => void;
  onDecided: (decided: Decided) => void;
  onLater: (card: Card) => void;
  onReview: (card: Card) => void;
  onOpenChat: (chatId: string) => void;
}

const CONTROLS = 'button, a, [role="button"], [tabindex]';

function elsewhere(target: EventTarget | null, own: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('input, textarea, select') !== null) return true;
  const inHome = target.closest('.isl-home') !== null;
  return inHome && target.closest(CONTROLS) !== null && !own?.contains(target);
}

function useAnswerKeys(
  on: boolean,
  own: RefObject<HTMLElement | null>,
  allow: () => void,
  deny: () => void,
) {
  const handlers = useRef({ allow, deny });
  useEffect(() => {
    handlers.current = { allow, deny };
  });
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || elsewhere(event.target, own.current)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'y') handlers.current.allow();
      else if (key === 'n') handlers.current.deny();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [on, own]);
}

function Pager({ index, total, onPage }: Pick<FocusCardProps, 'index' | 'total' | 'onPage'>) {
  if (total < 2) return null;
  return (
    <div className="isl-pager" role="group" aria-label="Requests">
      <button
        type="button"
        className="isl-pager-step"
        aria-label="Previous request"
        onClick={() => onPage(index - 1)}
      >
        ‹
      </button>
      {Array.from({ length: total }, (_, dot) => (
        <button
          key={dot}
          type="button"
          className="isl-pager-dot"
          aria-label={`Request ${dot + 1} of ${total}`}
          aria-current={dot === index || undefined}
          onClick={() => onPage(dot)}
        />
      ))}
      <span className="isl-pager-text">
        {index + 1} of {total}
      </span>
      <button
        type="button"
        className="isl-pager-step"
        aria-label="Next request"
        onClick={() => onPage(index + 1)}
      >
        ›
      </button>
    </div>
  );
}

function OpenChat({
  card,
  onOpenChat,
  label,
}: { card: Card; label: string } & Pick<FocusCardProps, 'onOpenChat'>) {
  return (
    <button type="button" className="isl-focus-open" onClick={() => onOpenChat(card.chat.id)}>
      {card.chat.sessionType === 'terminal' ? 'Answer in Terminal' : label}
      <ExternalLinkIcon />
    </button>
  );
}

export function FocusCard(props: FocusCardProps) {
  const { card, agent } = props;
  const approval = card.approval;
  const armed = useArmed(approval?.id ?? card.chat.id);
  const decide = useDecide(approval, props.onDecided, agent);
  const allow = approval ? findOption(approval, 'allow_once') : undefined;
  const deny = approval
    ? (findOption(approval, 'reject_once') ?? findOption(approval, 'reject_always'))
    : undefined;
  const ready = armed && !decide.isPending && !card.loading;
  const send = (option: ApprovalOption | undefined) => {
    if (option && ready) decide.mutate({ option, scope: 'once' });
  };
  const keys = answerable(card);
  const own = useRef<HTMLElement>(null);
  useAnswerKeys(
    keys,
    own,
    () => send(allow),
    () => send(deny),
  );
  const question = card.kind === 'question' && approval && isCheckpoint(approval) ? approval : null;
  const asks = question ? 'question' : 'permission';
  const title = question
    ? (askedPrompt(question) ?? cardLine(card).text)
    : approval
      ? cardHeading(card, agent)
      : cardLine(card).text;
  const reason = approval?.reason?.trim() || null;
  return (
    <article
      ref={own}
      className="isl-focus"
      data-kind={card.kind}
      data-seen={props.seen || undefined}
      aria-label={`${card.chat.title} needs you`}
    >
      <div className="isl-focus-who">
        <span className="isl-focus-blob">
          <SessionBlob chat={card.chat} state="waiting" size={112} />
          <span className="isl-focus-ask" data-asks={asks} aria-hidden="true">
            {question ? '?' : '!'}
          </span>
        </span>
        <b className="isl-focus-chat">{card.chat.title}</b>
        <span className="isl-focus-sub">{[agent, props.project].filter(Boolean).join(' · ')}</span>
        {props.seen && <span className="isl-inbox-seen">Seen</span>}
        <Pager index={props.index} total={props.total} onPage={props.onPage} />
      </div>
      <div className="isl-focus-body">
        <h3 className="isl-focus-title">{title}</h3>
        {card.loading ? (
          <div className="isl-skl" aria-hidden="true">
            <i />
          </div>
        ) : (
          approval && !question && card.kind !== 'open' && <Target approval={approval} />
        )}
        {reason && !question && <p className="isl-focus-why">{reason}</p>}
        {question && (
          <div className="isl-focus-choices">
            <QuestionChoices
              approval={question}
              armed={armed}
              busy={decide.isPending}
              onPick={(pick) => decide.mutate(pickDecision(pick, agent))}
            />
          </div>
        )}
        <div className="isl-focus-acts" data-in-place>
          {card.kind === 'approval' && approval && (
            <>
              <button
                type="button"
                className="isl-btn big primary"
                data-arming={!armed || undefined}
                disabled={!ready || !allow}
                onClick={() => send(allow)}
              >
                Allow {keys && <Kbd>Y</Kbd>}
              </button>
              <button
                type="button"
                className="isl-btn big deny"
                data-arming={!armed || undefined}
                disabled={!ready || !deny}
                onClick={() => send(deny)}
              >
                Deny {keys && <Kbd>N</Kbd>}
              </button>
            </>
          )}
          {card.kind === 'force' && approval && (
            <>
              <button
                type="button"
                className="isl-btn big deny"
                data-arming={!armed || undefined}
                disabled={!ready || !deny}
                onClick={() => send(deny)}
              >
                Deny
              </button>
              <button type="button" className="isl-btn big" onClick={() => props.onReview(card)}>
                Review
              </button>
            </>
          )}
          <button type="button" className="isl-btn big" onClick={() => props.onLater(card)}>
            Later
          </button>
          <span className="isl-sp" />
          <OpenChat
            card={card}
            onOpenChat={props.onOpenChat}
            label={question ? 'Reply in chat' : 'Open chat'}
          />
        </div>
        {decide.isError && (
          <p className="isl-err" role="alert">
            {decide.error.message}
          </p>
        )}
      </div>
    </article>
  );
}
