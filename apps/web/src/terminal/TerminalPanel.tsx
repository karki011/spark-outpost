import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProviderId, TerminalHint, TerminalStep } from '@spark-outpost/contracts';
import { LabelText } from '../providers/LabelText.tsx';
import { CheckIcon, XIcon } from '../ui/icons.tsx';
import { createTerminalSession } from './terminal-api.ts';
import { openTerminal, type TerminalConnection } from './terminal-connection.ts';
import { endMessages } from './terminal-messages.ts';
import './terminal.css';

const problemHints = new Set(['npm_missing', 'npm_permissions', 'cli_not_found']);

const CHECK_AGAIN_DELAY_MS = 1200;

interface TerminalPanelProps {
  provider: ProviderId;
  providerName: string;
  reason?: string | null;
  step: TerminalStep;
  onCheckAgain: () => void;
  onDismiss: () => void;
  compact?: boolean;
}

type GuideState = 'todo' | 'active' | 'done';

function GuideStep({ state, children }: { state: GuideState; children: ReactNode }) {
  return (
    <li className={`tg-step ${state}`}>
      <span className="tg-dot" aria-hidden="true">
        {state === 'done' ? <CheckIcon /> : null}
      </span>
      <span className="tg-text">{children}</span>
    </li>
  );
}

export function TerminalPanel({
  provider,
  providerName,
  reason,
  step,
  onCheckAgain,
  onDismiss,
  compact = false,
}: TerminalPanelProps) {
  const screen = useRef<HTMLDivElement>(null);
  const connection = useRef<TerminalConnection | null>(null);
  const [status, setStatus] = useState<'starting' | 'open' | 'ended'>('starting');
  const [command, setCommand] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<TerminalHint | null>(null);
  const [tall, setTall] = useState(false);
  const checkAgainRef = useRef(onCheckAgain);

  useEffect(() => {
    checkAgainRef.current = onCheckAgain;
  });

  useEffect(() => {
    if (!hint?.checkAgain) return;
    const timeout = setTimeout(() => checkAgainRef.current(), CHECK_AGAIN_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [hint]);

  useEffect(() => {
    if (!screen.current) return;
    const opened = openTerminal(() => createTerminalSession(provider, step), screen.current, {
      onOpen: (created) => {
        setStatus('open');
        setCommand(created.command);
      },
      onCommandRun: () => setRan(true),
      onHint: setHint,
      onInputError: setNotice,
      onEnded: (reason) => {
        setStatus('ended');
        setNotice(endMessages[reason]);
      },
      onError: (message) => {
        setStatus('ended');
        setNotice(message);
      },
    });
    connection.current = opened;
    return () => opened.dispose();
  }, [provider, step]);

  const login = step === 'login';
  const checking = hint?.checkAgain === true;
  const title = login ? `Sign in to ${providerName}` : `Install ${providerName}`;
  const waitText = login
    ? 'Finish signing in in the browser window that opens'
    : 'Wait for the install to finish';
  const statusText =
    status === 'starting'
      ? 'Starting…'
      : status === 'open'
        ? checking
          ? 'Checking again…'
          : ran
            ? 'Running'
            : 'Ready'
        : notice;

  return (
    <section
      className={compact ? `term-panel compact${tall ? ' tall' : ''}` : 'term-panel'}
      aria-label="Terminal"
    >
      <div className="term-guide">
        <b>{title}</b>
        {reason && (
          <p className="tg-reason">
            <LabelText label={reason} />
          </p>
        )}
        <ol>
          <GuideStep state={ran ? 'done' : 'active'}>
            <span>
              Run <code>{command ?? '…'}</code>
            </span>
            {!ran && (
              <button
                type="button"
                className="btn primary sm"
                disabled={status !== 'open'}
                onClick={() => connection.current?.run()}
              >
                Run it
              </button>
            )}
          </GuideStep>
          <GuideStep state={checking ? 'done' : ran ? 'active' : 'todo'}>{waitText}</GuideStep>
          <GuideStep state={checking ? 'active' : 'todo'}>
            <span>Spark Outpost checks again by itself</span>
            <button type="button" className="link" onClick={onCheckAgain}>
              Check now
            </button>
          </GuideStep>
        </ol>
      </div>
      <div className="term-head">
        <span className={`term-light ${status}`} aria-hidden="true" />
        <b>Terminal</b>
        <span className="term-status" aria-live="polite">
          {statusText}
        </span>
        {compact && (
          <button
            type="button"
            className="term-size"
            aria-pressed={tall}
            onClick={() => setTall((value) => !value)}
          >
            Taller
          </button>
        )}
        <button
          type="button"
          className="term-close"
          aria-label={status === 'ended' ? 'Dismiss' : 'Close'}
          title={status === 'ended' ? 'Dismiss' : 'Close terminal'}
          onClick={() => (status === 'ended' ? onDismiss() : connection.current?.close())}
        >
          <XIcon />
        </button>
      </div>
      <div className="term-screen" ref={screen} />
      {hint && (
        <p className={`term-hint${problemHints.has(hint.id) ? ' warn' : ''}`} role="status">
          <LabelText label={hint.message} />
        </p>
      )}
      <p className="term-foot">Closes by itself after 10 minutes without input.</p>
    </section>
  );
}
