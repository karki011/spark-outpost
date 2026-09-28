import type { AgentConfigSwitch, RepoAgentConfig, RepoMcpServer } from '@spark-outpost/contracts';
import { IGNORED_LABELS, ignoredCount } from './agent-setup.ts';
import { SetupCard, SetupList, SetupSwitch } from './SetupCard.tsx';
import type { AgentConfigChange } from './use-agent-config.ts';

interface CardsProps {
  config: RepoAgentConfig;
  name: string;
  busy: boolean;
  onChange: (change: AgentConfigChange) => void;
}

const onOff = (on: boolean) => (on ? 'On' : 'Off');

function switchFor(
  { config, name, busy, onChange }: CardsProps,
  key: AgentConfigSwitch,
  label: string,
) {
  return {
    label: `${label} from ${name}`,
    checked: config.settings[key],
    disabled: busy,
    onChange: (checked: boolean) => onChange({ type: 'settings', change: { [key]: checked } }),
  };
}

export function EverydayCards(props: CardsProps) {
  const { config } = props;
  const files = config.instructions.map((file) => ({
    key: file.path,
    name: file.path,
    detail: file.nested ? 'read when working in that folder' : undefined,
  }));
  const definitions = (items: RepoAgentConfig['skills']) =>
    items.map((item) => ({ key: item.path, name: item.name, detail: item.description }));
  return (
    <>
      <SetupCard
        title="Instructions"
        count={config.instructions.length}
        toggle={
          config.instructions.length > 0
            ? switchFor(props, 'instructions', 'Follow instructions')
            : undefined
        }
      >
        {files.length === 0 ? (
          <p className="as-empty">No CLAUDE.md, AGENTS.md or rules files.</p>
        ) : (
          <SetupList label="files" items={files} preview={4} />
        )}
      </SetupCard>
      <SetupCard
        title="Skills"
        count={config.skills.length}
        toggle={config.skills.length > 0 ? switchFor(props, 'skills', 'Use skills') : undefined}
      >
        <SetupList label="skills" items={definitions(config.skills)} />
      </SetupCard>
      <SetupCard
        title="Commands"
        count={config.commands.length}
        toggle={
          config.commands.length > 0 ? switchFor(props, 'commands', 'Use commands') : undefined
        }
      >
        <SetupList label="commands" items={definitions(config.commands)} />
      </SetupCard>
      <SetupCard
        title="Subagents"
        count={config.subagents.length}
        toggle={
          config.subagents.length > 0 ? switchFor(props, 'subagents', 'Use subagents') : undefined
        }
      >
        <SetupList label="subagents" items={definitions(config.subagents)} />
      </SetupCard>
    </>
  );
}

const TRUSTED_STATUS = 'On · trusted folder';

export function HooksCard({ config, name, busy, onChange }: CardsProps) {
  if (config.hooks.length === 0) return null;
  const { hooks, hooksChanged } = config.settings;
  const trusted = config.trust.state === 'trusted';
  const items = config.hooks.map((hook, index) => ({
    key: `${hook.source}-${index}`,
    name: hook.command,
    detail: `${hook.event}${hook.matcher ? ` · ${hook.matcher}` : ''} · ${hook.source}`,
  }));
  return (
    <SetupCard
      title="Hooks"
      count={config.hooks.length}
      status={trusted ? TRUSTED_STATUS : onOff(hooks)}
      tone="warn"
      toggle={
        trusted
          ? undefined
          : {
              label: `Run hooks from ${name}`,
              checked: hooks,
              disabled: busy || config.hooksFingerprint === null,
              onChange: (checked) =>
                onChange({
                  type: 'settings',
                  change: checked
                    ? { hooks: true, hooksFingerprint: config.hooksFingerprint ?? '' }
                    : { hooks: false },
                }),
            }
      }
    >
      <p className="as-warn">
        Hooks run these shell commands on your computer at agent events, and can approve or block
        tool calls. Turn them on only if you trust this repo. Claude only.
      </p>
      {hooksChanged && (
        <p className="as-warn" role="status">
          The hooks changed since you turned them on, so they are off. Review them again.
        </p>
      )}
      <SetupList label="hooks" items={items} preview={2} />
    </SetupCard>
  );
}

function serverDetail(server: RepoMcpServer): string {
  const target =
    server.transport === 'stdio'
      ? [server.command, ...server.args].join(' ')
      : `${server.transport.toUpperCase()} ${server.url}`;
  const env = server.envNames.length > 0 ? ` · env ${server.envNames.join(', ')}` : '';
  return `${target}${env}`;
}

export function McpCard({ config, name, busy, onChange }: CardsProps) {
  if (config.mcpServers.length === 0) return null;
  const on = config.mcpServers.filter((server) => server.enabled).length;
  const trusted = config.trust.state === 'trusted';
  return (
    <SetupCard
      title="MCP servers"
      count={config.mcpServers.length}
      status={trusted ? TRUSTED_STATUS : `${on} on`}
      tone="warn"
    >
      <p className="as-warn">
        Servers run programs or reach services with your access. Each tool call asks first, except
        at Full auto. Secrets in your shell are not passed.
      </p>
      <ul className="as-servers">
        {config.mcpServers.map((server) => (
          <li key={server.name}>
            <span className="as-server-text">
              <code>{server.name}</code>
              <small>{serverDetail(server)}</small>
              {server.changed && (
                <small className="as-changed">Changed since you turned it on</small>
              )}
            </span>
            {!trusted && (
              <SetupSwitch
                label={`Use MCP server ${server.name} from ${name}`}
                checked={server.enabled}
                disabled={busy}
                onChange={(checked) =>
                  onChange({
                    type: 'mcp',
                    name: server.name,
                    change: checked
                      ? { enabled: true, fingerprint: server.fingerprint }
                      : { enabled: false },
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
    </SetupCard>
  );
}

export function IgnoredCard({ config }: { config: RepoAgentConfig }) {
  if (config.ignored.length === 0) return null;
  return (
    <SetupCard title="Ignored settings" count={ignoredCount(config)} status="Never applied">
      <p className="as-empty">
        Spark Outpost’s approval rules always apply, so these repo settings are not used.
      </p>
      <details className="as-more">
        <summary>Show ignored settings</summary>
        <ul className="as-list">
          {config.ignored.map((group) => (
            <li key={`${group.source}-${group.kind}`}>
              <b>{IGNORED_LABELS[group.kind]}</b>
              <small>
                {group.source}: {group.items.join(', ')}
              </small>
            </li>
          ))}
        </ul>
      </details>
    </SetupCard>
  );
}
