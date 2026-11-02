import { useState, type ReactNode } from 'react';
import {
  PLUGINS_EDIT_NOTE,
  pluginsEditByline,
  type PluginFinding,
  type PluginsEditAction,
  type SparkAction,
} from '@spark-outpost/contracts';
import { FOLDED_RULES, findingTitle } from '../../settings/plugin-model.ts';
import { PluginStatus } from '../../settings/PluginStatus.tsx';

export const PLUGINS_ON_THE_MAC = 'Waiting for you on your Mac. Plugins are turned on there.';

const SHOWN_ITEMS = 3;

const AGENT_REVIEW_NOTE = {
  done: null,
  pending: 'Agent review checking…',
  failed: 'Agent review failed',
  off: 'Agent review off',
} as const;

interface Item {
  key: string;
  label: string;
  code: string;
}

function place(file: string, line: number | null): string {
  return line === null ? file : `${file}:${line}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function shownFindings(findings: readonly PluginFinding[]): PluginFinding[] {
  return findings.filter(
    (finding) => finding.source !== 'check' || !FOLDED_RULES.has(finding.rule),
  );
}

function Collapsible<T>({
  items,
  render,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hidden = items.length - SHOWN_ITEMS;
  const visible = open || hidden <= 0 ? items : items.slice(0, SHOWN_ITEMS);
  return (
    <dd>
      <ul className="sac-items">{visible.map(render)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          className="sac-link sac-plug-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show fewer' : `and ${hidden} more`}
        </button>
      )}
    </dd>
  );
}

function CodeRow({ label, items }: { label: string; items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <dt>{label}</dt>
      <Collapsible
        items={items}
        render={(item) => (
          <li key={item.key}>
            {item.label} <code>{item.code}</code>
          </li>
        )}
      />
    </>
  );
}

function FindingsRow({ findings }: { findings: PluginFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <>
      <dt>Findings</dt>
      <Collapsible
        items={findings}
        render={(finding, index) => (
          <li key={`${finding.rule}-${index}`}>
            <PluginStatus status={finding.severity} /> <b>{findingTitle(finding)}</b>{' '}
            <code>{place(finding.file, finding.line)}</code> {finding.reason}{' '}
            <span className="sac-plug-rule">{finding.rule}</span>
          </li>
        )}
      />
    </>
  );
}

function StatusLine({ action }: { action: PluginsEditAction }) {
  const extras = [
    action.findings.length > 0 ? plural(action.findings.length, 'finding') : null,
    AGENT_REVIEW_NOTE[action.agentReview],
  ].filter((extra) => extra !== null);
  return (
    <dd>
      <PluginStatus status={action.status} />
      {extras.map((extra) => ` · ${extra}`).join('')}
    </dd>
  );
}

export function PluginEditFacts({ action }: { action: PluginsEditAction }) {
  return (
    <dl className="sac-facts sac-plug">
      <dt>Plugin</dt>
      <dd>
        {action.name}
        {action.version ? ` ${action.version}` : ''} <code>{action.key}</code>
      </dd>
      <dt>Status</dt>
      <StatusLine action={action} />
      <FindingsRow findings={shownFindings(action.findings)} />
      <CodeRow
        label="Hooks"
        items={action.hooks.map((hook, index) => ({
          key: `${hook.event}-${index}`,
          label: hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event,
          code: hook.command,
        }))}
      />
      <CodeRow
        label="Inline shell"
        items={action.inlineShell.map((shell) => ({
          key: `${shell.file}:${shell.line}`,
          label: place(shell.file, shell.line),
          code: shell.text,
        }))}
      />
      <CodeRow
        label="MCP servers"
        items={action.mcpServers.map((server) => ({
          key: server.name,
          label: server.name,
          code: server.target,
        }))}
      />
    </dl>
  );
}

export function pluginsByline(action: SparkAction): string | null {
  return action.action === 'plugins_edit' ? pluginsEditByline(action) : null;
}

export function pluginsNote(action: SparkAction): string | null {
  return action.action === 'plugins_edit' ? PLUGINS_EDIT_NOTE : null;
}
