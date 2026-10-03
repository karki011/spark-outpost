import './member-chat.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STEER_TEXT_LIMIT, type MemberMessage } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { useRunStream } from '../chat/use-run-stream.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { CrewBlob } from './CrewBlob.tsx';
import { crewStateWord, modelLabel, roleLabel, type CrewAgent } from './crew-model.ts';
import { memberApi } from './member-api.ts';
import { canContinue, memberIsLive } from './member-model.ts';
import { MemberMessageList } from './MemberMessageList.tsx';

const TAIL_STEPS = 3;
const TAIL_CHARS = 360;

interface MemberChatProps {
  conversationId: string;
  agent: CrewAgent;
  messages: readonly MemberMessage[];
  onClose(): void;
}

function tail(text: string): string {
  const flat = text.trim();
  return flat.length > TAIL_CHARS ? `…${flat.slice(-TAIL_CHARS)}` : flat;
}

function MemberTail({ conversationId, agent }: { conversationId: string; agent: CrewAgent }) {
  const stream = useRunStream(agent.id, conversationId);
  const steps = stream.steps.slice(-TAIL_STEPS);
  const text = tail(stream.text);
  if (steps.length === 0 && !text) {
    return (
      <div className="mc-tail" aria-busy="true">
        <i className="mc-skl" />
        <i className="mc-skl short" />
      </div>
    );
  }
  return (
    <div className="mc-tail" aria-label={`${agent.name}'s latest work`} role="group">
      {steps.length > 0 && (
        <ul className="mc-steps">
          {steps.map((step, index) => (
            <li key={`${index}-${step.name}`} className={step.done ? 'done' : 'open'}>
              {step.name}
            </li>
          ))}
        </ul>
      )}
      {text && <p className="mc-text">{text}</p>}
    </div>
  );
}

export function MemberChat({ conversationId, agent, messages, onClose }: MemberChatProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const secrets = useSecretGuard(text);
  const live = memberIsLive(agent);
  const resumable = !live && canContinue(agent);
  const closed = !live && !resumable;
  const send = useMutation({
    mutationFn: (body: { id: string; text: string }) =>
      memberApi.send(agent.id, body.id, body.text, resumable),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    },
  });
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = () => {
    const body = text.trim();
    if (!body || closed || send.isPending || secrets.blocks(text)) return;
    send.mutate({ id: draftId, text: body }, { onSuccess: () => setDraftId(crypto.randomUUID()) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const action = resumable ? `Continue ${agent.name}` : `Send to ${agent.name}`;
  return createPortal(
    <div className="mchat" role="dialog" aria-labelledby={titleId}>
      <div className="mc-h">
        <span className="mc-blob" aria-hidden="true">
          <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={30} />
        </span>
        <span className="mc-who">
          <b id={titleId}>Message {agent.name}</b>
          <small>
            {roleLabel(agent)} · {modelLabel(agent)}
          </small>
        </span>
        <span className={`mc-state ${agent.state}`}>{crewStateWord(agent.state)}</span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <MemberTail conversationId={conversationId} agent={agent} />
      <MemberMessageList name={agent.name} live={live} messages={messages} />
      <p className="mc-reply" role="status">
        {send.data?.reply ?? ''}
      </p>
      {send.isError && (
        <p className="mc-err" role="alert">
          {send.error.message}
        </p>
      )}
      <div className="mc-compose">
        <SecretWarning guard={secrets} input={inputRef} onText={setText} onSendAnyway={submit} />
        <label className="sr-only" htmlFor={`${titleId}-input`}>
          Message to {agent.name}
        </label>
        <textarea
          id={`${titleId}-input`}
          ref={inputRef}
          rows={2}
          maxLength={STEER_TEXT_LIMIT}
          disabled={closed}
          placeholder={
            closed
              ? `${agent.name} has finished. Ask in the chat instead.`
              : resumable
                ? `${agent.name} has finished. Say what to pick back up…`
                : `Tell ${agent.name} something. It reads it at its next step.`
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="mc-bar">
          <span className="mc-hint">
            {live ? 'Goes to this agent only, no approval needed' : ''}
          </span>
          <button
            type="button"
            className="mc-send"
            disabled={closed || !text.trim() || send.isPending}
            onClick={submit}
          >
            {action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
