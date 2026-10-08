import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ConversationSummary, NativeTerminalSession } from '@spark-outpost/contracts';
import { SessionBlob } from '../island/SessionBlob.tsx';
import { terminalMood } from './native-state.ts';

export function TerminalCompanion({
  chat,
  state,
}: {
  chat: ConversationSummary;
  state: NativeTerminalSession['state'];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [happy, setHappy] = useState(false);
  const previous = useRef(state);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setVisible(document.visibilityState === 'visible' && element.getClientRects().length > 0);
    const observer = new IntersectionObserver((entries) =>
      setVisible(document.visibilityState === 'visible' && (entries[0]?.isIntersecting ?? false)),
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    const finished = previous.current === 'working' && state === 'ready';
    previous.current = state;
    if (!finished) return;
    setHappy(true);
    const timer = setTimeout(() => setHappy(false), 2200);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span
      ref={ref}
      className="native-companion"
      data-state={state}
      data-motion={visible && !reduced ? 'on' : 'off'}
      aria-hidden="true"
    >
      <SessionBlob
        chat={chat}
        state={happy && state === 'ready' ? 'done' : terminalMood(state)}
        size={38}
        live={visible && !reduced}
      />
    </span>
  );
}
