import { useEffect, useRef } from 'react';
import { AgentCards } from './AgentCards.tsx';
import { useAgentsFocusRequest, useFocusedAgent, useShownAgents } from './agent-board.ts';
import { usePaneId } from '../split/chat-pane.ts';

export function AgentsSection() {
  const shown = useShownAgents();
  const focusRequest = useAgentsFocusRequest();
  const focusedAgent = useFocusedAgent();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = usePaneId('wp-agents');

  useEffect(() => {
    if (focusRequest === 0 || focusedAgent) return;
    const frame = requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, focusedAgent]);

  if (!shown || shown.rows.length === 0) return null;
  return (
    <section className="wsec ac-section" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="ac-head">
        Agents · {shown.rows.length}
      </h2>
      <AgentCards rows={shown.rows} live={shown.live} focus={focusedAgent} />
    </section>
  );
}
