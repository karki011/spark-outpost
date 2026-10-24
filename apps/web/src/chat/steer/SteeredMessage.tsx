import './steer.css';
import type { ConversationDetail, MemberMessage, Run } from '@spark-outpost/contracts';
import { CheckIcon, ClockIcon, StrokeIcon, WarnIcon } from '../../ui/icons.tsx';
import { MessageActions } from '../message-actions/MessageActions.tsx';
import { QuotedText } from '../quotes/QuotedText.tsx';
import {
  canResend,
  steerAnchor,
  steerGroups,
  turnSteers,
  type SteerSeen,
  type SteerStatus,
} from './steer-model.ts';
import { useSteerActions } from './use-steer-actions.ts';

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

interface SteerGroupProps {
  messages: readonly MemberMessage[];
  detail: ConversationDetail;
  run: Run;
  crew: boolean;
  seen?: SteerSeen;
}

function StatusIcon({ tone }: { tone: SteerStatus['tone'] }) {
  if (tone === 'ok') return <CheckIcon className="steer-icon" />;
  if (tone === 'miss') return <WarnIcon />;
  if (tone === 'stopped') return <StrokeIcon path="M7 7h10v10H7z" />;
  return <ClockIcon />;
}

function SteerLine({ status }: { status: SteerStatus }) {
  return (
    <p className="steer-status" role="status" aria-live="polite">
      <StatusIcon tone={status.tone} />
      <span className="steer-text">{status.text}</span>
      {status.at && <span className="steer-at"> · {clock.format(new Date(status.at))}</span>}
    </p>
  );
}

function MissedActions({
  messages,
  conversationId,
}: {
  messages: readonly MemberMessage[];
  conversationId: string;
}) {
  const actions = useSteerActions(conversationId);
  return (
    <div className="steer-acts">
      <button
        type="button"
        className="btn primary sm"
        disabled={actions.pending}
        onClick={() => actions.resend(messages)}
      >
        Send as next message
      </button>
      <button
        type="button"
        className="btn ghost sm"
        disabled={actions.pending}
        onClick={() => actions.edit(messages)}
      >
        Edit
      </button>
      {actions.error && (
        <span className="steer-error" role="alert">
          {actions.error}
        </span>
      )}
    </div>
  );
}

export function SteerGroup({ messages, detail, run, crew, seen }: SteerGroupProps) {
  return steerGroups(messages, detail, run, crew, seen).map(({ messages: group, status }) => (
    <div
      key={group[0]!.id}
      className={`msg me steered ${status.tone}`}
      data-steer={group.at(-1)!.status}
    >
      {group.map((message) => (
        <div
          key={message.id}
          id={steerAnchor(message.id)}
          className="bubble steer-item"
          data-message-id={message.id}
        >
          <QuotedText text={message.body} />
        </div>
      ))}
      <SteerLine status={status} />
      <MessageActions
        text={group.map((message) => message.body).join('\n\n')}
        createdAt={group[0]!.createdAt}
        copyLabel={group.length > 1 ? 'Copy messages' : 'Copy message'}
        side="user"
      />
      {group.every(canResend) && (
        <MissedActions messages={group} conversationId={detail.conversation.id} />
      )}
    </div>
  ));
}

interface SteeredMessageProps {
  message: MemberMessage;
  detail: ConversationDetail;
  run: Run;
  crew: boolean;
}

export function SteeredMessage({ message, detail, run, crew }: SteeredMessageProps) {
  return <SteerGroup messages={[message]} detail={detail} run={run} crew={crew} />;
}

interface TurnSteersProps {
  detail: ConversationDetail;
  run: Run;
}

export function TurnSteers({ detail, run }: TurnSteersProps) {
  return (
    <SteerGroup messages={turnSteers(detail, run.id)} detail={detail} run={run} crew={false} />
  );
}
