import { useEffect, useRef } from 'react';
import { AgentCards } from './AgentCards.tsx';
import { useAgentsFocusRequest, useShownAgents } from './agent-board.ts';

export function AgentsSection() {
  const shown = useShownAgents();
  const focusRequest = useAgentsFocusRequest();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  if (!shown || shown.rows.length === 0) return null;
  return (
    <section className="wsec ac-section" aria-labelledby="wp-agents">
      <h2 id="wp-agents" ref={heading} tabIndex={-1} className="ac-head">
        Agents · {shown.rows.length}
      </h2>
      <AgentCards rows={shown.rows} live={shown.live} />
    </section>
  );
}
