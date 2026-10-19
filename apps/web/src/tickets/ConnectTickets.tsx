import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ATLASSIAN_NAME, ticketSourceNames, type TicketSourceId } from '@spark-outpost/contracts';
import { useExpandReveal } from '../ui/transitions.tsx';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { LinearMark, TicketGlyph } from './ticket-icons.tsx';

function ConnectButtons({
  focus,
  onPick,
}: {
  focus: TicketSourceId | null;
  onPick: (source: TicketSourceId) => void;
}) {
  const jiraRef = useRef<HTMLButtonElement>(null);
  const linearRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focus === 'jira') jiraRef.current?.focus();
    if (focus === 'linear') linearRef.current?.focus();
  }, [focus]);

  return (
    <>
      <button ref={jiraRef} type="button" className="btn primary" onClick={() => onPick('jira')}>
        <TicketGlyph />
        Connect {ATLASSIAN_NAME}
      </button>
      <button ref={linearRef} type="button" className="btn line" onClick={() => onPick('linear')}>
        <LinearMark />
        Connect Linear
      </button>
    </>
  );
}

const nameOf = (source: TicketSourceId) =>
  source === 'jira' ? ATLASSIAN_NAME : ticketSourceNames[source];

export function ConnectTickets() {
  const [source, setSource] = useState<TicketSourceId | null>(null);
  const [returnTo, setReturnTo] = useState<TicketSourceId | null>(null);
  const expand = useExpandReveal();
  const cancel = () => {
    setReturnTo(source);
    setSource(null);
  };
  return (
    <div className="tk-empty">
      <div>
        <span className="tk-big" aria-hidden="true">
          <TicketGlyph size={26} />
        </span>
        <h2>See your tickets here</h2>
        <p>
          Connect Atlassian (for Jira) or Linear and Spark sorts the tickets assigned to you into
          what needs you, what&rsquo;s in flight and what&rsquo;s next. Search covers every ticket
          you can see, and you can assign one to yourself.
        </p>
        <AnimatePresence initial={false} mode="wait">
          {source ? (
            <motion.div key={source} className="tk-connect-wrap" {...expand}>
              <section className="tk-connect-card" aria-label={`Connect ${nameOf(source)}`}>
                <h3>Connect {nameOf(source)}</h3>
                <TicketConnectForm source={source} onCancel={cancel} />
              </section>
            </motion.div>
          ) : (
            <motion.div key="cta" className="tk-cta" {...expand}>
              <ConnectButtons focus={returnTo} onPick={setSource} />
            </motion.div>
          )}
        </AnimatePresence>
        <p className="tk-foot">
          Tokens stay in your macOS keychain. Spark changes a ticket only when you start work, open
          a PR or assign it to yourself.
        </p>
      </div>
    </div>
  );
}
