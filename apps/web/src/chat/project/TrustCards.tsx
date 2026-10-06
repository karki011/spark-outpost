import type { RepoAgentConfig, RepoRedirect } from '@spark-outpost/contracts';
import {
  CHANGE_KINDS,
  CHANGE_LABELS,
  executableSummary,
  onOff,
  trustPrompt,
} from './agent-setup.ts';
import { SetupCard, SetupList, type SetupCardsProps } from './SetupCard.tsx';

function ChangeList({ config }: { config: RepoAgentConfig }) {
  const items = config.trust.changes.map((change, index) => ({
    key: `${change.kind}-${index}`,
    name: change.label,
    detail: `${CHANGE_LABELS[change.change]} ${CHANGE_KINDS[change.kind]}`,
  }));
  return <SetupList label="changes" items={items} preview={4} />;
}

export function TrustCard({ config, name, busy, onChange }: SetupCardsProps) {
  const { trust } = config;
  if (!trust.needed) return null;
  const trusted = trust.state === 'trusted';
  const grant = () =>
    onChange({ type: 'trust', change: { trusted: true, fingerprint: trust.fingerprint } });
  const decline = () => onChange({ type: 'trust', change: { trusted: false } });

  if (trusted) {
    return (
      <SetupCard title="Trusted folder" status="Trusted">
        <p className="as-empty">
          Hooks, allow rules and MCP servers from {name} load as its developers set them. Spark
          Outpost’s safety rules still apply: changes to secret files ask, nothing is pushed without
          your permission choice, and every change is recorded.
        </p>
        <div className="as-actions">
          <button type="button" className="btn line sm" disabled={busy} onClick={decline}>
            Stop trusting
          </button>
        </div>
      </SetupCard>
    );
  }

  const prompt = trustPrompt(config);
  return (
    <SetupCard
      title={prompt === 'changed' ? 'Folder setup changed' : 'Trust this folder?'}
      status={executableSummary(config)}
      tone="warn"
    >
      {prompt === 'changed' ? (
        <p className="as-warn" role="status">
          {name} changed since you trusted it, so its hooks, allow rules and MCP servers are off.
          Review what changed and trust it again.
        </p>
      ) : (
        <p className="as-warn">
          {name} has hooks, allow rules or MCP servers that can run commands on your computer. Trust
          this folder only if you trust the people who wrote it.
        </p>
      )}
      {prompt === 'changed' && <ChangeList config={config} />}
      <div className="as-actions">
        <button type="button" className="btn primary sm" disabled={busy} onClick={grant}>
          Trust this folder
        </button>
        {prompt === 'ask' && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={decline}>
            Not now
          </button>
        )}
      </div>
    </SetupCard>
  );
}

export function AllowRulesCard({ config }: { config: RepoAgentConfig }) {
  if (config.allowRules.length === 0) return null;
  const trusted = config.trust.state === 'trusted';
  const applied = config.allowRules.filter((rule) => rule.applied).length;
  const items = config.allowRules.map((rule, index) => ({
    key: `${rule.source}-${index}`,
    name: rule.rule,
    detail: rule.reason
      ? `Not applied: ${rule.reason} · ${rule.source}`
      : `${trusted ? 'Applied' : 'Applied when trusted'} · ${rule.source}`,
  }));
  return (
    <SetupCard
      title="Allow rules"
      count={config.allowRules.length}
      status={trusted ? `${applied} applied` : 'Off'}
      tone="warn"
    >
      <p className="as-empty">
        Allowed commands run without asking. Rules that could push code, read secret files or allow
        everything are never applied.
      </p>
      <SetupList label="allow rules" items={items} preview={3} />
    </SetupCard>
  );
}

const redirectName = (redirect: RepoRedirect) =>
  `${redirect.name} = ${redirect.value ?? 'value hidden'}`;

export function RedirectsCard({ config, name, busy, onChange }: SetupCardsProps) {
  if (config.redirects.length === 0) return null;
  const { trust } = config;
  const trusted = trust.state === 'trusted';
  const on = trust.redirects === 'on';
  const items = config.redirects.map((redirect, index) => ({
    key: `${redirect.source}-${index}`,
    name: redirectName(redirect),
    detail: `${redirect.kind === 'env' ? 'Environment variable' : 'Runs a command'} · ${redirect.source}`,
  }));
  return (
    <SetupCard
      title="Keys and traffic"
      count={config.redirects.length}
      status={onOff(on)}
      tone="warn"
      toggle={{
        label: `Use key and proxy settings from ${name}`,
        checked: on,
        disabled: busy || !trusted,
        onChange: (checked) =>
          onChange({
            type: 'redirects',
            change: checked
              ? { confirmed: true, fingerprint: trust.redirectsFingerprint ?? '' }
              : { confirmed: false },
          }),
      }}
    >
      <p className="as-warn">
        These settings can send your API key and every request to another server. Trusting the
        folder does not turn them on. Claude only.
      </p>
      {!trusted && <p className="as-empty">Trust this folder first to use them.</p>}
      {trust.redirects === 'changed' && (
        <p className="as-warn" role="status">
          These settings changed since you turned them on, so they are off. Review them again.
        </p>
      )}
      <SetupList label="settings" items={items} preview={3} />
    </SetupCard>
  );
}
