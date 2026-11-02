import { useState, type ReactNode } from 'react';
import { ProviderBlob } from '../src/brand/ProviderBlob.tsx';
import { Glyph } from '../src/tickets/ticket-icons.tsx';
import { PullRequestIcon } from '../src/chat/rail/RailIcons.tsx';
import type { Pane } from './main.tsx';

function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="preview-section" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function Inspector({
  onPane,
  signedIn,
  changesOnly,
}: {
  onPane: (pane: Pane) => void;
  signedIn: boolean;
  changesOnly: boolean;
}) {
  return (
    <div className="preview-inspector-content">
      {!changesOnly && (
        <>
          <Section title="Environment">
            <div className="preview-fact">
              <span>▱</span>
              <span>This computer</span>
              <small>Local</small>
            </div>
            <div className="preview-fact">
              <span>▱</span>
              <span>orders-web-app</span>
            </div>
            <div className="preview-fact">
              <PullRequestIcon />
              <span className="preview-truncate">spark/ai-signals-reports</span>
              <small>Worktree</small>
            </div>
          </Section>
          <Section title="Agents">
            <div className="preview-agent-row">
              <ProviderBlob providerId="claude" size={27} />
              <div>
                Report implementation<small>Claude · Updating route tests</small>
              </div>
              <span className="preview-status">Working</span>
            </div>
            <div className="preview-agent-row">
              <ProviderBlob providerId="codex" size={27} />
              <div>
                Browser verification<small>Codex · Checking report layouts</small>
              </div>
              <span className={signedIn ? 'preview-status' : 'preview-warning'}>
                {signedIn ? 'Working' : 'Needs you'}
              </span>
            </div>
            <button className="preview-text-button" onClick={() => onPane('agents')}>
              Open Agent TV <span>↗</span>
            </button>
          </Section>
        </>
      )}
      <Section title="Changes">
        <button className="preview-pr" onClick={() => onPane('changes')}>
          <PullRequestIcon />
          <div>
            Order Insights built-in reports<small>orders-web-app · #2453</small>
            <span className="preview-success">
              ✓ Checks passed <span className="preview-muted">· Review requested</span>
            </span>
          </div>
          <span>↗</span>
        </button>
        <div className="preview-change-total">
          <span>6 files changed</span>
          <span className="preview-success">
            +194 <span className="preview-danger">−46</span>
          </span>
        </div>
        {changesOnly && (
          <div className="preview-file-list">
            {[
              'reports-overview.tsx',
              'adoption-page.tsx',
              'capitalization-page.tsx',
              'work-items-page.tsx',
              'report-routes.test.ts',
              'report-labels.test.ts',
            ].map((file) => (
              <div key={file}>
                <Glyph name="box" />
                {file}
                <span className="preview-success">M</span>
              </div>
            ))}
            <p className="preview-muted">
              Sample change summary. No repository files are changed by these controls.
            </p>
          </div>
        )}
      </Section>
      {!changesOnly && (
        <>
          <Section title="Connections">
            <div className="preview-fact">
              <Glyph name="ticket" />
              <span>Atlassian</span>
              <small className="preview-success">Connected</small>
            </div>
            <div className="preview-fact">
              <Glyph name="circle" />
              <span>Acme</span>
              {signedIn ? (
                <small className="preview-success">Signed in</small>
              ) : (
                <button className="preview-warning" onClick={() => onPane('signin')}>
                  Approve site
                </button>
              )}
            </div>
          </Section>
          <Section title="Context" open={false}>
            <div className="preview-fact">
              <span>29% used</span>
              <small>176.6k / 600k</small>
            </div>
            <progress max={100} value={29} aria-label="Sample context usage" />
            <p className="preview-muted">
              Sample usage. Provider-specific breakdowns appear only when the provider reports them.
            </p>
          </Section>
          <Section title="Servers">
            <div className="preview-fact">
              <Glyph name="circle" />
              <span>web</span>
              <small>localhost:8081</small>
            </div>
          </Section>
          <div className="preview-inspector-foot">
            Background tasks <span>2 running</span>
          </div>
        </>
      )}
    </div>
  );
}

export function AgentPanel() {
  const [selected, setSelected] = useState('Report implementation');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Record<string, string[]>>({});
  const [stopped, setStopped] = useState<string[]>([]);
  const [stage, setStage] = useState(false);
  const agents = ['Report implementation', 'Browser verification'];
  return (
    <div className="preview-agent-panel">
      <div className="preview-segment">
        <button aria-pressed={!stage} onClick={() => setStage(false)}>
          List
        </button>
        <button aria-pressed={stage} onClick={() => setStage(true)}>
          Stage
        </button>
      </div>
      {stage && (
        <div className="preview-stage">
          {agents.map((name, index) => (
            <button key={name} onClick={() => setSelected(name)}>
              <ProviderBlob providerId={index ? 'codex' : 'claude'} size={80} />
              <span>{index ? 'Verifier' : 'Builder'}</span>
              <small>{stopped.includes(name) ? 'Stopped' : 'Working'}</small>
            </button>
          ))}
        </div>
      )}
      <div className="preview-agents-list">
        {agents.map((name, index) => (
          <button key={name} aria-pressed={selected === name} onClick={() => setSelected(name)}>
            <ProviderBlob providerId={index ? 'codex' : 'claude'} size={32} />
            <span>
              {name}
              <small>
                {stopped.includes(name)
                  ? 'Stopped'
                  : index
                    ? 'Checking responsive layouts'
                    : 'Fixing the route test fixture'}
              </small>
            </span>
            <span>›</span>
          </button>
        ))}
      </div>
      <section className="preview-agent-detail">
        <div className="preview-fact">
          <strong>{selected}</strong>
          <button
            className="preview-muted"
            onClick={() =>
              setStopped(
                stopped.includes(selected)
                  ? stopped.filter((name) => name !== selected)
                  : [...stopped, selected],
              )
            }
          >
            {stopped.includes(selected) ? 'Resume' : 'Stop'}
          </button>
        </div>
        <small className="preview-muted">Order Insights built-in reports</small>
        <div className="preview-agent-transcript">
          <p>
            {selected === agents[0]
              ? 'I found the missing fixture. I’m updating the test and checking the affected route.'
              : 'I’m checking the report navigation and the layout at narrow widths.'}
          </p>
          {(messages[selected] ?? []).map((message, index) => (
            <div className="preview-agent-message" key={index}>
              {message}
              <small>Delivered · simulated</small>
            </div>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) {
              setMessages({
                ...messages,
                [selected]: [...(messages[selected] ?? []), draft.trim()],
              });
              setDraft('');
            }
          }}
        >
          <label htmlFor="agent-message">Message this agent</label>
          <textarea
            id="agent-message"
            placeholder="Add a detail or steer the work…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="preview-fact">
            <small className="preview-muted">Only this agent receives it.</small>
            <button
              className="preview-primary"
              disabled={!draft.trim() || stopped.includes(selected)}
            >
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SignInPanel({ signedIn, onSignIn }: { signedIn: boolean; onSignIn: () => void }) {
  const [approved, setApproved] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <div className="preview-signin">
      <div className="preview-address">
        <Glyph name="circle" />
        <span>auth-dev.acme.example</span>
      </div>
      {signedIn ? (
        <div className="preview-signin-content">
          <Glyph name="check" size={30} />
          <h2>Session ready</h2>
          <p>The verifier continues in the same browser session.</p>
          <p className="preview-muted">
            This preview simulates a successful login. No credentials were used.
          </p>
        </div>
      ) : (
        <div className="preview-signin-content">
          <Glyph name="info" size={26} />
          <h2>
            {manual ? 'Finish signing in' : approved ? 'Site approved' : 'Use your saved sign-in?'}
          </h2>
          <p>
            {manual
              ? 'Spark waits while you complete SSO, a passkey, or MFA in the browser.'
              : approved
                ? 'Spark can use the saved Acme sign-in on this exact development site.'
                : 'The development app uses a different sign-in address. Allow this site once to reuse your Acme sign-in here.'}
          </p>
          <dl>
            <dt>Saved sign-in</dt>
            <dd>Acme · Work</dd>
            <dt>Additional site</dt>
            <dd>https://auth-dev.acme.example</dd>
          </dl>
          <p className="preview-muted">
            Credentials stay in Keychain. Manage approved sites in Settings → Projects → Saved
            sign-ins.
          </p>
          <button
            className="preview-primary"
            onClick={() => (approved || manual ? onSignIn() : setApproved(true))}
          >
            {manual
              ? 'Simulate completed sign-in'
              : approved
                ? 'Simulate successful sign-in'
                : 'Approve this site'}
          </button>
          {!manual && (
            <button className="preview-text-button" onClick={() => setManual(true)}>
              Sign in myself instead
            </button>
          )}
        </div>
      )}
    </div>
  );
}
