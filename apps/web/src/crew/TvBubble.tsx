import type { CSSProperties, ReactNode } from 'react';
import { StepName } from '../chat/WorkLog.tsx';
import { crewStateWord, headerMeta, type CrewAgent } from './crew-model.ts';
import type { BubbleBox } from './tv-layout.ts';
import { roleTitle, type TvAsk } from './tv-scene.ts';

function place(box: BubbleBox): CSSProperties {
  const vertical: CSSProperties = box.below ? { top: box.edge } : { bottom: box.edge };
  return {
    ...vertical,
    left: box.left,
    width: box.width,
    '--arrow': `${box.arrow}px`,
  } as CSSProperties;
}

interface ShellProps {
  box: BubbleBox;
  kind: 'detail' | 'ask' | 'chat';
  id?: string;
  label?: string;
  hidden?: boolean;
  children: ReactNode;
}

function Shell({ box, kind, id, label, hidden, children }: ShellProps) {
  return (
    <div
      id={id}
      className={`tv-bub tv-${kind}${box.below ? ' tv-below' : ''}`}
      style={place(box)}
      role={label ? 'group' : undefined}
      aria-label={label}
      aria-hidden={hidden || undefined}
    >
      {children}
    </div>
  );
}

interface DetailProps {
  id: string;
  box: BubbleBox;
  agent: CrewAgent;
  ask: TvAsk | undefined;
  onGo(): void;
  onAsk(approvalId: string): void;
}

export function DetailBubble({ id, box, agent, ask, onGo, onAsk }: DetailProps) {
  const meta = headerMeta(agent);
  return (
    <Shell box={box} kind="detail" id={id} label={`${agent.name} details`}>
      <p className="tv-bub-t">
        <b>{agent.name}</b>
        <span className="tv-bub-role">{roleTitle(agent)}</span>
      </p>
      <p className="tv-bub-state" data-state={agent.state}>
        <i aria-hidden="true" />
        {crewStateWord(agent.state)}
      </p>
      {agent.line && (
        <p className="tv-bub-now" title={agent.line.replaceAll('`', '')}>
          <StepName name={agent.line} />
        </p>
      )}
      {meta && <p className="tv-bub-m">{meta}</p>}
      <div className="tv-bub-a">
        {ask && (
          <button type="button" className="tv-bub-go warn" onClick={() => onAsk(ask.approvalId)}>
            Answer
          </button>
        )}
        <button type="button" className="tv-bub-go" onClick={onGo}>
          Show in chat
        </button>
      </div>
    </Shell>
  );
}

interface AskProps {
  box: BubbleBox;
  agent: CrewAgent;
  ask: TvAsk;
  onAsk(approvalId: string): void;
}

export function AskBubble({ box, agent, ask, onAsk }: AskProps) {
  return (
    <Shell box={box} kind="ask">
      <button
        type="button"
        className="tv-bub-ask"
        aria-label={`${agent.name}: ${ask.text} Go to the card`}
        onClick={() => onAsk(ask.approvalId)}
      >
        {ask.text}
      </button>
    </Shell>
  );
}

export function ChatBubble({ box, text }: { box: BubbleBox; text: string }) {
  return (
    <Shell box={box} kind="chat" hidden>
      {text}
    </Shell>
  );
}
