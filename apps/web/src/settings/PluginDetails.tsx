import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PluginScanStatus, UserPlugin } from '@spark-outpost/contracts';
import { userPluginsApi, userPluginsKey } from '../api/user-plugins.ts';
import { usageLine } from '../usage/format.ts';
import {
  autoRunStatus,
  autoRuns,
  decisionGroups,
  detailsSummary,
  findingPlace,
  findingTitle,
  otherGroups,
  type DecisionGroup,
  type RuleGroup,
} from './plugin-model.ts';
import { PluginStatus } from './PluginStatus.tsx';

const SHOWN_PLACES = 3;

function DetailsGroup({
  title,
  aside,
  status,
  children,
}: {
  title: string;
  aside?: string;
  status?: PluginScanStatus | null;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="plug-group" role="group" aria-labelledby={headingId}>
      <header className="plug-group-head">
        <h5 id={headingId}>{title}</h5>
        {aside && <span className="plug-aside">{aside}</span>}
        {status && <PluginStatus status={status} />}
      </header>
      {children}
    </section>
  );
}

function Decisions({ group }: { group: DecisionGroup }) {
  return (
    <DetailsGroup title={group.label} aside={String(group.findings.length)}>
      <ul className="plug-findings">
        {group.findings.map((finding, index) => {
          const title = findingTitle(finding);
          return (
            <li key={`${finding.rule}-${index}`} className="plug-finding">
              <span className="plug-finding-head">
                <PluginStatus status={finding.severity} />
                <b>{title}</b>
              </span>
              <span className="plug-reason">{finding.reason}</span>
              <span className="plug-where">
                <code>{findingPlace(finding)}</code>
                {title !== finding.rule && <span className="plug-rule">{finding.rule}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </DetailsGroup>
  );
}

function AutoRuns({ plugin }: { plugin: UserPlugin }) {
  const rows = autoRuns(plugin);
  if (rows.length === 0) return null;
  return (
    <DetailsGroup title="Runs automatically" aside="Spark check" status={autoRunStatus(plugin)}>
      <table className="plug-runs">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Runs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.when}</td>
              <td title={row.full}>
                <code>{row.runs}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DetailsGroup>
  );
}

function RuleItems({ group }: { group: RuleGroup }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hidden = group.findings.length - SHOWN_PLACES;
  const shown = open || hidden <= 0 ? group.findings : group.findings.slice(0, SHOWN_PLACES);
  return (
    <li className="plug-rule-group">
      <span className="plug-finding-head">
        <b>{group.title}</b>
        <span className="plug-aside">{group.findings.length}</span>
        <span className="plug-rule">{group.rule}</span>
      </span>
      <span className="plug-reason">{group.reason}</span>
      <ul id={listId} className="plug-places">
        {shown.map((finding, index) => (
          <li key={`${findingPlace(finding)}-${index}`}>
            <code>{findingPlace(finding)}</code>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="plug-show"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </li>
  );
}

function OtherFindings({ plugin }: { plugin: UserPlugin }) {
  const groups = otherGroups(plugin);
  if (groups.length === 0) return null;
  return (
    <DetailsGroup title="Other findings" aside="Spark check" status="review">
      <ul className="plug-findings">
        {groups.map((group) => (
          <RuleItems key={group.rule} group={group} />
        ))}
      </ul>
    </DetailsGroup>
  );
}

function SlashCommands({ plugin }: { plugin: UserPlugin }) {
  if (plugin.commandNames.length === 0) return null;
  return (
    <DetailsGroup title="Slash commands" aside={String(plugin.commandNames.length)}>
      <ul className="plug-commands">
        {plugin.commandNames.map((name) => (
          <li key={name}>
            <code>/{name}</code>
          </li>
        ))}
      </ul>
    </DetailsGroup>
  );
}

function CheckAgain({ plugin }: { plugin: UserPlugin }) {
  const queryClient = useQueryClient();
  const again = useMutation({
    mutationFn: () => userPluginsApi.review(plugin.key),
    onSuccess: (response) => queryClient.setQueryData(userPluginsKey, response),
  });
  return (
    <>
      <button
        type="button"
        className="btn line sm"
        disabled={again.isPending}
        onClick={() => again.mutate()}
      >
        Check again
      </button>
      {again.isError && (
        <span className="plug-foot-error" role="alert">
          {again.error.message}
        </span>
      )}
    </>
  );
}

function reviewLine(plugin: UserPlugin): string {
  const { agentReview, agentReviewCost, agentReviewError } = plugin.scan;
  if (agentReview === 'pending') return 'Agent review · Checking…';
  if (agentReview === 'off') return 'Agent review off · Only Spark’s check ran';
  if (agentReview === 'failed') {
    return agentReviewError ? `Agent review failed: ${agentReviewError}` : 'Agent review failed';
  }
  const usage = agentReviewCost ? usageLine(agentReviewCost.tokens, agentReviewCost.usd) : null;
  return usage ? `Agent review · ${usage}` : 'Agent review · Done';
}

function ReviewFooter({ plugin }: { plugin: UserPlugin }) {
  return (
    <footer className="plug-foot">
      <span>{reviewLine(plugin)}</span>
      {plugin.scan.agentReview === 'failed' && <CheckAgain plugin={plugin} />}
    </footer>
  );
}

export function PluginDetails({ plugin, id }: { plugin: UserPlugin; id: string }) {
  const decisions = decisionGroups(plugin);
  const clean = plugin.scan.findings.length === 0 && plugin.scan.status !== 'pending';
  return (
    <div id={id} className="plug-details" role="region" aria-label={`${plugin.name} details`}>
      <p className="plug-sum">{detailsSummary(plugin)}</p>
      {clean && <p className="plug-none">No findings.</p>}
      {decisions.map((group) => (
        <Decisions key={group.source} group={group} />
      ))}
      <AutoRuns plugin={plugin} />
      <OtherFindings plugin={plugin} />
      <SlashCommands plugin={plugin} />
      <ReviewFooter plugin={plugin} />
    </div>
  );
}
