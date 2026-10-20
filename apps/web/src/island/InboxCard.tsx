import { useEffect, useRef, type RefObject } from 'react';
import type { ApprovalOption } from '@spark-outpost/contracts';
import { isCheckpoint } from '../chat/checkpoints/checkpoint-model.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { QuestionChoices } from './CardView.tsx';
import { answerable, cardLine, shortAgo } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { Kbd, useArmed } from './island-parts.tsx';
import { findOption, useDecide, type Decided } from './use-decide.ts';

interface InboxCardProps {
  card: Card;
  agent: string;
  now: number;
  top: boolean;
  onDecided: (decided: Decided) => void;
  onLater: (card: Card) => void;
  onReview: (card: Card) => void;
  onOpenChat: (chatId: string) => void;
}

const CONTROLS = 'button, a, [role="button"], [tabindex]';

function elsewhere(target: EventTarget | null, own: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('input, textarea, select') !== null) return true;
  const inInbox = target.closest('.isl-inbox') !== null;
  return inInbox && target.closest(CONTROLS) !== null && !own?.contains(target);
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

function AnswerInSpark({ card, onOpenChat }: Pick<InboxCardProps, 'card' | 'onOpenChat'>) {
  return (
    <button type="button" className="isl-btn" onClick={() => onOpenChat(card.chat.id)}>
      {card.chat.sessionType === 'terminal' ? 'Answer in Terminal' : 'Answer in Spark'}
      <ExternalLinkIcon />
    </button>
  );
}

export function InboxCard(props: InboxCardProps) {
  const { card, agent, now, top } = props;
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
  const keys = top && answerable(card);
  const own = useRef<HTMLLIElement>(null);
  useAnswerKeys(
    keys,
    own,
    () => send(allow),
    () => send(deny),
  );
  const line = cardLine(card);
  const at = approval?.createdAt ?? card.chat.waitingSince ?? card.chat.updatedAt;
  const question = card.kind === 'question' && approval && isCheckpoint(approval) ? approval : null;
  return (
    <li ref={own} className="isl-inbox-card" data-kind={card.kind}>
      <button
        type="button"
        className="isl-inbox-head"
        title={`Open ${card.chat.title} in Spark`}
        onClick={() => props.onOpenChat(card.chat.id)}
      >
        <span className="isl-inbox-dot" aria-hidden="true" />
        <b className="isl-inbox-title">{card.chat.title}</b>
        <span className="isl-inbox-sub">· {agent}</span>
        <time className="isl-inbox-time">{shortAgo(at, now)}</time>
      </button>
      {card.loading ? (
        <div className="isl-skl" aria-hidden="true">
          <i />
        </div>
      ) : (
        <p className="isl-inbox-what">
          {line.verb && <b>{line.verb} </b>}
          {line.code && <code>{line.code}</code>}
          {line.text}
        </p>
      )}
      {question && (
        <QuestionChoices
          approval={question}
          armed={armed}
          busy={decide.isPending}
          onPick={(optionId, label) =>
            decide.mutate({
              option: { optionId, name: label, kind: 'allow_once' },
              scope: 'once',
              said: { title: `Got it, using ${label}`, sub: `${agent} carries on.` },
            })
          }
        />
      )}
      <div className="isl-acts" data-in-place>
        {card.kind === 'approval' && approval && (
          <>
            <button
              type="button"
              className="isl-btn primary"
              data-arming={!armed || undefined}
              disabled={!ready || !allow}
              onClick={() => send(allow)}
            >
              Allow {keys && <Kbd>Y</Kbd>}
            </button>
            <button
              type="button"
              className="isl-btn"
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
              className="isl-btn"
              data-arming={!armed || undefined}
              disabled={!ready || !deny}
              onClick={() => send(deny)}
            >
              Deny
            </button>
            <button type="button" className="isl-btn" onClick={() => props.onReview(card)}>
              Review
            </button>
          </>
        )}
        {card.kind === 'open' && <AnswerInSpark card={card} onOpenChat={props.onOpenChat} />}
        <button type="button" className="isl-btn" onClick={() => props.onLater(card)}>
          Later
        </button>
      </div>
      {decide.isError && (
        <p className="isl-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </li>
  );
}
