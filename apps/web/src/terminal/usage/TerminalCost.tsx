import './terminal-usage.css';
import { useQuery } from '@tanstack/react-query';
import {
  reportedSessionTotal,
  reportedTotalNote,
  type NativeTerminalUsage,
} from '@spark-outpost/contracts';
import { formatTokens } from '../../chat/composer/model-options.ts';
import { formatCost } from '../../usage/format.ts';
import { terminalUsageQuery } from './terminal-usage-api.ts';
import { estimateTotal, turnUsageText } from './turn-usage-text.ts';

function ReportedTotal({ usage }: { usage: NativeTerminalUsage }) {
  const several = usage.reported.length > 1;
  const total = reportedSessionTotal(usage.reported);
  return (
    <section className="tu-reported" aria-label="Session total">
      <div className="wsec-h">
        <h3>Session total</h3>
        <span>{reportedTotalNote(usage.provider, usage.reported, usage.stopped)}</span>
      </div>
      {total !== null && several && (
        <p className="tu-total">
          <b>{formatCost(total)}</b>
          <small> {usage.reported.length} CLI sessions</small>
        </p>
      )}
      {usage.reported.map((reported, index) => (
        <div key={reported.nativeSessionId} className="tu-cli">
          <p className={several ? 'tu-total part' : 'tu-total'}>
            <b>{formatCost(reported.costUsd)}</b>
            {several && <small> CLI session {index + 1}</small>}
          </p>
          <ul className="tu-models" aria-label="Session total by model">
            {reported.models.map((model) => (
              <li key={model.model}>
                <span className="tu-name">{model.model}</span>
                <span>
                  in {formatTokens(model.input)} · out {formatTokens(model.output)}
                </span>
                <span className="tu-cost">
                  {model.costUsd === null ? 'unknown' : formatCost(model.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function TerminalCost({ conversationId }: { conversationId: string }) {
  const usage = useQuery(terminalUsageQuery(conversationId));
  if (!usage.data) return null;
  const { turns, provider } = usage.data;
  const estimate = estimateTotal(turns);
  return (
    <div className="wsec tu-cost-pane">
      <div className="wsec-h">
        <h3>By turn</h3>
        <span>
          {estimate === null
            ? 'no estimate yet'
            : `${formatCost(estimate, 'estimated')} estimated from tokens`}
        </span>
      </div>
      {turns.length === 0 ? (
        <p className="wnote first">No turns yet.</p>
      ) : (
        <ol className="tu-turns" aria-label="Usage by turn">
          {turns.map((turn, index) => {
            const text = turnUsageText(turn, provider);
            return (
              <li key={turn.runId}>
                <span className="tu-name">
                  Turn {index + 1}
                  {turn.model && <small> · {turn.model}</small>}
                </span>
                <span className="tu-cost">
                  {text.cost}
                  {text.origin && <small> {text.origin}</small>}
                </span>
                <span className="tu-tokens" title={text.detail ?? undefined}>
                  {text.tokens}
                  {text.detail && <small> · {text.detail}</small>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <ReportedTotal usage={usage.data} />
      <p className="wnote">
        Turn figures are a lower bound: they count only the replies the agent wrote to its session
        file. The session total is the agent&apos;s own figure and is never added to them.
      </p>
    </div>
  );
}
