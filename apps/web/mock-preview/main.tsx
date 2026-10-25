import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Rail, type AppView } from '../src/app/Rail.tsx';
import { ProviderBlob } from '../src/brand/ProviderBlob.tsx';
import { Glyph } from '../src/tickets/ticket-icons.tsx';
import { ChoicePicker } from '../src/ui/ChoicePicker.tsx';
import { Inspector, AgentPanel, SignInPanel } from './panels.tsx';
import { TicketPreview } from './tickets.tsx';
import '../src/app/base.css';
import '../src/chat/chat-surface.css';
import 'blobatar/motion.css';
import './preview.css';
import './panels.css';
import './tickets.css';
import './responsive.css';

const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    location.href,
  );
  if (url.pathname.startsWith('/api/')) return Promise.resolve(Response.json({ pausedAt: null }));
  return originalFetch(input, init);
};

export type Pane = 'workspace' | 'agents' | 'signin' | 'changes';

function Activity({ children, detail }: { children: React.ReactNode; detail: string }) {
  return (
    <details className="preview-activity">
      <summary>{children}</summary>
      <div>{detail}</div>
    </details>
  );
}

function Chat({ onPane, signedIn }: { onPane: (pane: Pane) => void; signedIn: boolean }) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [running, setRunning] = useState(true);
  return (
    <section className="preview-conversation" aria-label="Conversation">
      <div className="preview-thread">
        <div className="preview-user">Check CP-49859 and CP-50041. Are the reports ready?</div>
        <div className="preview-assistant">
          <p>
            The report labels and entry points are updated. I’m checking the browser flows and the
            remaining review feedback.
          </p>
          <Activity detail="Read the reports overview, report routes, and adoption tests. Two targeted checks passed.">
            Read 8 files · ran 2 checks
          </Activity>
          <p>
            <strong>The report changes are ready for review.</strong>
          </p>
          <ul>
            <li>Capitalization, Adoption, and Work Items now show “Estimated”.</li>
            <li>The unfinished custom report entry point is hidden.</li>
            <li>Existing reports continue to use the same data sources.</li>
          </ul>
          <p>
            The verifier is checking the narrow layout. I’m following up on one review comment in
            the meantime.
          </p>
          <button className="preview-agent-link" onClick={() => onPane('agents')}>
            <ProviderBlob providerId="claude" size={21} />
            <ProviderBlob providerId="codex" size={21} />2 agents working <span>View →</span>
          </button>
        </div>
        <div className="preview-user">Make sure all feedback is addressed, and test the UI.</div>
        <div className="preview-assistant">
          <Activity detail="Fetched comments and check results for the linked pull request. The reviewer found one route test that needs the new data-source fixture.">
            Fetched PR reviews, comments, and checks
          </Activity>
          <p>
            The review caught a missing fixture in a route test. I’m fixing that and re-running the
            affected checks.
          </p>
          <Activity detail="The saved login is restricted to its approved sites. The development login origin needs your approval before Spark can use it.">
            {signedIn
              ? 'Browser session ready · continued verification'
              : 'Opened the report · checked saved sign-ins'}
          </Activity>
          {!signedIn && (
            <button className="preview-attention" onClick={() => onPane('signin')}>
              <Glyph name="info" />
              <span>
                Approve the development sign-in site <small>Use your saved CloudZero sign-in</small>
              </span>
              <span>Review →</span>
            </button>
          )}
          {signedIn && (
            <p className="preview-success">
              <Glyph name="check" /> Signed in. The verifier can continue in the browser.
            </p>
          )}
        </div>
        {messages.map((message, i) => (
          <div className="preview-user" key={i}>
            {message}
          </div>
        ))}
      </div>
      <div className="preview-composer-area">
        <div className="preview-run">
          <span>{running ? '◌ Working · checking review feedback' : '■ Stopped'}</span>
          <button onClick={() => onPane('agents')}>Agents · 2</button>
        </div>
        <form
          className="preview-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) {
              setMessages([...messages, draft.trim()]);
              setDraft('');
            }
          }}
        >
          <textarea
            aria-label="Message Spark"
            placeholder="Send a message to Spark…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div>
            <span className="preview-muted">
              ＋ <span className="preview-attach-label">Attach files</span>
            </span>
            <span className="preview-grow" />
            <button
              type="button"
              onClick={() => setRunning(!running)}
              aria-label={running ? 'Stop mock run' : 'Resume mock run'}
            >
              {running ? '■' : '▶'}
            </button>
            <button type="submit" className="preview-send" aria-label="Send mock message">
              ↑
            </button>
          </div>
        </form>
        <div className="preview-composer-footer">
          <span>Bypass permissions</span>
          <span>
            Opus 5.5 · Medium <span className="preview-muted">⌄</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function Preview() {
  const [view, setView] = useState<'chats' | 'tickets'>('chats');
  const [pane, setPane] = useState<Pane>('workspace');
  const [open, setOpen] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [notice, setNotice] = useState('');
  const [skin, setSkin] = useState('loam');
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const showPane = (next: Pane) => {
    setPane(next);
    setOpen(true);
  };
  const go = (next: AppView) => {
    if (next === 'tickets' || next === 'chats') setView(next);
    else setNotice(`${next[0].toUpperCase()}${next.slice(1)} is outside this focused preview.`);
  };
  return (
    <div className="preview-root">
      <div className="preview-toolbar">
        <span>
          <strong>Design preview</strong>
          <span className="preview-toolbar-note"> · Sample data · main 0232cff9</span>
        </span>
        <div>
          <button
            aria-pressed={view === 'chats' && pane === 'workspace'}
            onClick={() => {
              setView('chats');
              showPane('workspace');
            }}
          >
            Chat
          </button>
          <button
            aria-pressed={view === 'chats' && pane === 'agents'}
            onClick={() => {
              setView('chats');
              showPane('agents');
            }}
          >
            Agent TV
          </button>
          <button
            aria-pressed={view === 'chats' && pane === 'signin'}
            onClick={() => {
              setView('chats');
              showPane('signin');
            }}
          >
            Sign-in
          </button>
          <button aria-pressed={view === 'tickets'} onClick={() => setView('tickets')}>
            Tickets
          </button>
          <ChoicePicker
            label="Preview theme"
            value={skin}
            choices={[
              { id: 'loam', label: 'Warm dark' },
              { id: 'graphite', label: 'Graphite' },
              { id: 'plum', label: 'Plum' },
              { id: 'light', label: 'Light' },
            ]}
            onChange={(value) => {
              setSkin(value);
              document.documentElement.dataset.skin = value;
            }}
          />
        </div>
      </div>
      <div className="app preview-app">
        <Rail
          view={view}
          waiting={0}
          ticketsWaiting={0}
          ticketNotices={0}
          mood={null}
          onView={go}
          onIntent={() => {}}
          onSettings={() =>
            setNotice('Use the theme picker above to preview Spark’s existing themes.')
          }
          onProfile={() => setNotice('This is a sample profile for the design preview.')}
        />
        {view === 'chats' ? (
          <>
            {sidebar && (
              <aside className="preview-sidebar">
                <h3>Chats</h3>
                <input aria-label="Search chats" placeholder="Search" />
                <p className="preview-muted">Projects</p>
                <p>⌄ feature-web-apps</p>
                <button className="preview-selected" onClick={() => setSidebar(false)}>
                  <ProviderBlob providerId="claude" size={18} />
                  AI Signals reports
                </button>
                <p>⌄ feature-data-access</p>
                <span className="preview-muted">Remove Dimension Workload</span>
              </aside>
            )}
            <main className="main preview-main">
              <header className="head chat-head">
                <button
                  className="preview-icon"
                  aria-label="Toggle chats sidebar"
                  onClick={() => setSidebar(!sidebar)}
                >
                  ☷
                </button>
                <span className="preview-project">feature-web-apps /</span>
                <h1 className="chat-title">AI Signals built-in reports</h1>
                <div className="head-r preview-head-actions">
                  <button onClick={() => showPane('changes')} className="preview-diff">
                    +194 <span>−46</span>
                  </button>
                  <button
                    className="preview-icon"
                    aria-label="Toggle workspace inspector"
                    onClick={() => setOpen(!open)}
                  >
                    ◫
                  </button>
                </div>
              </header>
              <div className={`preview-body ${open ? 'with-inspector' : ''}`}>
                <Chat onPane={showPane} signedIn={signedIn} />
                {open && (
                  <aside className="preview-inspector" aria-label="Workspace inspector">
                    <header>
                      <span>
                        {pane === 'workspace'
                          ? 'Workspace'
                          : pane === 'agents'
                            ? 'Agent TV'
                            : pane === 'signin'
                              ? 'Browser · Sign-in'
                              : 'Changes'}
                      </span>
                      <div>
                        {pane !== 'workspace' && (
                          <button
                            onClick={() => setPane('workspace')}
                            aria-label="Back to workspace"
                          >
                            ←
                          </button>
                        )}
                        <button onClick={() => setOpen(false)} aria-label="Close inspector">
                          ×
                        </button>
                      </div>
                    </header>
                    {pane === 'agents' ? (
                      <AgentPanel />
                    ) : pane === 'signin' ? (
                      <SignInPanel signedIn={signedIn} onSignIn={() => setSignedIn(true)} />
                    ) : (
                      <Inspector
                        onPane={showPane}
                        signedIn={signedIn}
                        changesOnly={pane === 'changes'}
                      />
                    )}
                  </aside>
                )}
              </div>
            </main>
          </>
        ) : (
          <TicketPreview
            syncing={syncing}
            failed={syncFailed}
            onSync={() => {
              setSyncFailed(false);
              setSyncing(true);
            }}
            onFinish={(failed) => {
              setSyncing(false);
              setSyncFailed(failed);
            }}
            onChat={() => {
              setView('chats');
              showPane('workspace');
            }}
          />
        )}
      </div>
      {notice && (
        <div className="preview-notice" role="status">
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <Preview />
  </QueryClientProvider>,
);
