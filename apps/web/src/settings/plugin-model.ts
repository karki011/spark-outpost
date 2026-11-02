import type { UserPlugin } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';

export function pluginAdds(plugin: UserPlugin): string {
  const parts = [
    plugin.skills > 0 && countLabel(plugin.skills, 'skill'),
    plugin.commands > 0 && countLabel(plugin.commands, 'command'),
    plugin.agents > 0 && countLabel(plugin.agents, 'subagent'),
    plugin.hooks.length > 0 && countLabel(plugin.hooks.length, 'hook'),
    plugin.mcpServers.length > 0 && countLabel(plugin.mcpServers.length, 'MCP server'),
  ].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? parts.join(' · ') : 'Adds nothing Spark can list';
}

export function needsConfirm(plugin: UserPlugin): boolean {
  return plugin.scan.status === 'review' || plugin.scan.status === 'flagged';
}

export function isChecking(plugin: UserPlugin): boolean {
  return plugin.scan.status === 'pending' || plugin.scan.agentReview === 'pending';
}

export function confirmText(plugin: UserPlugin): string {
  const findings = countLabel(plugin.scan.findings.length, 'finding');
  const hooks =
    plugin.hooks.length > 0 ? ' Hooks run on your computer without asking each time.' : '';
  const shell = plugin.scan.findings.some((finding) => finding.rule === 'inline-shell')
    ? ' Inline shell commands in its skills run without asking.'
    : '';
  const found = plugin.scan.findings.some((finding) => finding.source === 'agent')
    ? 'Spark’s check and agent review have'
    : 'Spark’s check has';
  return `${found} ${findings} for ${plugin.name}. Open Details to read them.${hooks}${shell}`;
}

export function findingPlace(finding: { file: string; line: number | null }): string {
  return finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
}

export function isOn(plugin: UserPlugin): boolean {
  return plugin.enabled && !plugin.changed;
}

function rank(plugin: UserPlugin): number {
  if (isOn(plugin)) return 0;
  if (plugin.scan.status === 'flagged') return 1;
  if (plugin.scan.status === 'review') return 2;
  return 3;
}

export function sortPlugins(plugins: readonly UserPlugin[]): UserPlugin[] {
  return [...plugins].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.key.localeCompare(b.key),
  );
}

export function filterPlugins(plugins: readonly UserPlugin[], filter: string): UserPlugin[] {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...plugins];
  return plugins.filter((plugin) => {
    const text = `${plugin.name} ${plugin.marketplace} ${plugin.description}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function pluginSummary(plugins: readonly UserPlugin[], shown: number): string {
  const review = plugins.filter(needsConfirm).length;
  const parts = [`${plugins.filter(isOn).length} on`, `${plugins.length} installed`];
  if (review > 0) parts.push(`${review} ${review === 1 ? 'needs' : 'need'} review`);
  if (shown !== plugins.length) parts.push(`${shown} shown`);
  return parts.join(' · ');
}

type Finding = UserPlugin['scan']['findings'][number];
type Severity = Finding['severity'];

export const FOLDED_RULES: ReadonlySet<string> = new Set(['hook', 'mcp-server', 'inline-shell']);

export function findingTitle(finding: Pick<Finding, 'rule' | 'title'>): string {
  if (finding.title) return finding.title;
  const words = finding.rule.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function bySeverity(a: { severity: Severity }, b: { severity: Severity }): number {
  return (a.severity === 'flagged' ? 0 : 1) - (b.severity === 'flagged' ? 0 : 1);
}

function worst(findings: readonly { severity: Severity }[]): Severity {
  return findings.some((finding) => finding.severity === 'flagged') ? 'flagged' : 'review';
}

export interface DecisionGroup {
  source: Finding['source'];
  label: string;
  severity: Severity;
  findings: Finding[];
}

export function decisionGroups(plugin: UserPlugin): DecisionGroup[] {
  const decisions = plugin.scan.findings.filter(
    (finding) => finding.source === 'agent' || finding.severity === 'flagged',
  );
  const groups = (['agent', 'check'] as const).flatMap((source) => {
    const findings = decisions.filter((finding) => finding.source === source).sort(bySeverity);
    if (findings.length === 0) return [];
    const label = source === 'agent' ? 'Agent review' : 'Spark check';
    return [{ source, label, severity: worst(findings), findings }];
  });
  return groups.sort(bySeverity);
}

export interface RuleGroup {
  rule: string;
  title: string;
  reason: string;
  findings: Finding[];
}

export function otherGroups(plugin: UserPlugin): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const finding of plugin.scan.findings) {
    if (finding.source !== 'check' || finding.severity !== 'review') continue;
    if (FOLDED_RULES.has(finding.rule)) continue;
    const group = groups.get(finding.rule) ?? {
      rule: finding.rule,
      title: findingTitle(finding),
      reason: finding.reason,
      findings: [],
    };
    group.findings.push(finding);
    groups.set(finding.rule, group);
  }
  return [...groups.values()];
}

export interface AutoRun {
  key: string;
  when: string;
  runs: string;
  full: string;
}

const PLUGIN_ROOT = /\$\{CLAUDE_PLUGIN_ROOT\}\/|\$CLAUDE_PLUGIN_ROOT\//g;

export function shortCommand(command: string): string {
  return command.replace(PLUGIN_ROOT, '');
}

function serverTarget(server: UserPlugin['mcpServers'][number]): string {
  if (server.command) return [server.command, ...server.args].join(' ');
  return server.url ?? '';
}

function inlineShell(plugin: UserPlugin): Finding[] {
  return plugin.scan.findings.filter(
    (finding) => finding.source === 'check' && finding.rule === 'inline-shell',
  );
}

export function autoRuns(plugin: UserPlugin): AutoRun[] {
  return [
    ...plugin.hooks.map((hook, index) => ({
      key: `hook-${index}`,
      when: hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event,
      runs: shortCommand(hook.command),
      full: hook.command,
    })),
    ...plugin.mcpServers.map((server) => ({
      key: `mcp-${server.name}`,
      when: `Chat start · MCP server ${server.name}`,
      runs: shortCommand(serverTarget(server)),
      full: serverTarget(server),
    })),
    ...inlineShell(plugin).map((finding) => ({
      key: `shell-${findingPlace(finding)}`,
      when: 'Skill or command loads',
      runs: findingPlace(finding),
      full: `${findingPlace(finding)}: ${finding.reason}`,
    })),
  ];
}

export function autoRunStatus(plugin: UserPlugin): Severity | null {
  const folded = plugin.scan.findings.filter(
    (finding) => finding.source === 'check' && FOLDED_RULES.has(finding.rule),
  );
  return folded.length > 0 ? worst(folded) : null;
}

function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function addsSentence(plugin: UserPlugin): string | null {
  const parts = [
    plugin.skills > 0 && countLabel(plugin.skills, 'skill'),
    plugin.commands > 0 && countLabel(plugin.commands, 'command'),
    plugin.agents > 0 && countLabel(plugin.agents, 'subagent'),
  ].filter((part): part is string => typeof part === 'string');
  return parts.length > 0 ? `Adds ${listed(parts)}.` : null;
}

function runsSentences(plugin: UserPlugin): string[] {
  const shell = inlineShell(plugin).length;
  const startsOwn = plugin.scan.findings.some(
    (finding) => finding.source === 'check' && finding.rule === 'frontmatter-hooks',
  );
  const servers = plugin.mcpServers.length;
  const sentences = [
    plugin.hooks.length > 0 &&
      `Runs ${countLabel(plugin.hooks.length, 'command')} automatically on Claude events, without asking.`,
    shell > 0 &&
      `Its skills run ${countLabel(shell, 'shell command')} without asking when they load.`,
    startsOwn && 'Some skills start their own hooks or MCP servers when used.',
    servers > 0 &&
      `Starts ${servers === 1 ? 'its MCP server' : `${servers} MCP servers`} with each chat; tool calls follow the chat’s mode.`,
  ].filter((sentence): sentence is string => typeof sentence === 'string');
  return sentences.length > 0 ? sentences : ['Nothing runs on its own.'];
}

function findingsSentences(plugin: UserPlugin): string[] {
  if (plugin.scan.status === 'pending') return ['Spark is still checking it.'];
  const flagged = plugin.scan.findings.filter(
    (finding) => finding.source === 'check' && finding.severity === 'flagged',
  ).length;
  const agent = plugin.scan.findings.filter((finding) => finding.source === 'agent').length;
  return [
    flagged > 0 && `Spark’s check flagged ${countLabel(flagged, 'thing')}.`,
    agent > 0 && `The agent review found ${countLabel(agent, 'thing')} to check.`,
  ].filter((sentence): sentence is string => typeof sentence === 'string');
}

export function detailsSummary(plugin: UserPlugin): string {
  return [addsSentence(plugin), ...runsSentences(plugin), ...findingsSentences(plugin)]
    .filter((sentence): sentence is string => sentence !== null)
    .join(' ');
}
