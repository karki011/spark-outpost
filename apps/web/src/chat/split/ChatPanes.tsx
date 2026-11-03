import './chat-split.css';
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChatView } from '../ChatView.tsx';
import { XIcon } from '../../ui/icons.tsx';
import { SplitDivider, percent } from '../../ui/SplitDivider.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { ChatPaneContext, SINGLE_PANE, type ChatPane } from './chat-pane.ts';
import type { PaneSide } from './chat-split.ts';
import type { ChatSplitControl } from './use-chat-split.ts';

const StableChatView = memo(ChatView);
const PANE_NAMES: Record<PaneSide, string> = { primary: 'Left chat', secondary: 'Right chat' };

function focusPrimaryComposer() {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('.cpane[data-side="primary"] .composer textarea')?.focus(),
  );
}

function CloseSplit({ onClose }: { onClose: () => void }) {
  const tip = useTooltip('Close this chat');
  return (
    <>
      <button
        type="button"
        className="icon-btn cpane-close"
        aria-label="Close right chat"
        {...tip.triggerProps}
        onClick={() => {
          onClose();
          focusPrimaryComposer();
        }}
      >
        <XIcon />
      </button>
      {tip.tooltip}
    </>
  );
}

interface PaneProps {
  side: PaneSide;
  pane: ChatPane;
  onFocus(side: PaneSide): void;
  children: ReactNode;
}

function Pane({ side, pane, onFocus, children }: PaneProps) {
  return (
    <div
      className="cpane"
      data-side={side}
      data-focused={pane.focused ? 'true' : 'false'}
      onPointerDownCapture={() => onFocus(side)}
      onFocusCapture={() => onFocus(side)}
    >
      <ChatPaneContext value={pane}>{children}</ChatPaneContext>
    </div>
  );
}

function usePane(side: PaneSide, split: boolean, focused: boolean, closer: ReactNode): ChatPane {
  return useMemo(
    () =>
      split
        ? {
            focused,
            idSuffix: side === 'secondary' ? '-split' : '',
            name: PANE_NAMES[side],
            landmark: side === 'primary' ? 'main' : 'section',
            closer,
          }
        : SINGLE_PANE,
    [side, split, focused, closer],
  );
}

interface ChatPanesProps {
  primary: string;
  control: ChatSplitControl;
  onOpenChat(id: string): void;
}

export function ChatPanes({ primary, control, onOpenChat }: ChatPanesProps) {
  const { secondary, focus, ratio, setRatio, focusPane, close } = control;
  const split = secondary !== null;
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? ratio;
  const closer = useMemo(() => <CloseSplit onClose={() => close('secondary')} />, [close]);
  const left = usePane('primary', split, focus === 'primary', null);
  const right = usePane('secondary', split, focus === 'secondary', closer);
  const style = split ? ({ '--cpanes-split': shown } as CSSProperties) : undefined;

  return (
    <div className={split ? 'cpanes split' : 'cpanes'} style={style}>
      <Pane key="primary" side="primary" pane={left} onFocus={focusPane}>
        <StableChatView key={primary} conversationId={primary} onOpenChat={onOpenChat} />
      </Pane>
      {split && (
        <SplitDivider
          key="divider"
          ratio={shown}
          label="Resize chats"
          valueText={`Left chat ${percent(shown)} percent. Arrow keys resize, Enter resets.`}
          move={setMoving}
          commit={(next) => {
            setMoving(null);
            setRatio(next);
          }}
        />
      )}
      {split && (
        <Pane key="secondary" side="secondary" pane={right} onFocus={focusPane}>
          <StableChatView key={secondary} conversationId={secondary} onOpenChat={onOpenChat} />
        </Pane>
      )}
    </div>
  );
}
