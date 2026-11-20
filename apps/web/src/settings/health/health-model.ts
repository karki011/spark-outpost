import {
  terminalModText,
  type CalendarStatus,
  type ConversationSummary,
  type MacControlStatus,
  type Project,
  type ProviderSetup,
  type RepoAgentConfig,
  type SparkRules,
  type UserPlugin,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { macState } from '../../calendar/today-model.ts';
import { IGNORED_LABELS, ignoredCount } from '../../chat/project/agent-setup.ts';
import { terminalEnded } from '../../terminal/native-state.ts';
import { countLabel } from '../../ui/count-label.ts';
import { macControlHelperMissing } from '../mac-control-status.ts';
import { unloadableText } from '../plugin-model.ts';
import { PLUGINS_LABEL } from '../PluginsSettings.tsx';
import { OUTSIDE_TITLE } from '../RulesOutsideNotice.tsx';
import { unusedEntriesTitle } from '../spark-rules/rule-rows.ts';
import type { SettingsSection } from '../section-ids.ts';

export type HealthStatus = 'broken' | 'ignored';

export type HealthFix =
  | { kind: 'section'; section: SettingsSection; focus?: string; label: string }
  | { kind: 'chat'; conversationId: string; label: string }
  | { kind: 'note'; text: string };

export interface HealthItem {
  key: string;
  status: HealthStatus;
  title: string;
  detail: string | null;
  fix: HealthFix;
}

const OPEN_RULES: HealthFix = { kind: 'section', section: 'rules', label: 'Open Spark rules' };
const OPEN_PROJECTS: HealthFix = { kind: 'section', section: 'projects', label: 'Open Projects' };
const OPEN_PROVIDERS: HealthFix = { kind: 'section', section: 'ai', label: 'Open AI providers' };
const OPEN_PLUGINS: HealthFix = {
  kind: 'section',
  section: 'chats',
  focus: PLUGINS_LABEL,
  label: 'Open plugins',
};
const AGENT_SETUP: HealthFix = {
  kind: 'note',
  text: 'Open Agent setup in a chat that uses this folder.',
};

const openChat = (conversationId: string): HealthFix => ({
  kind: 'chat',
  conversationId,
  label: 'Open chat',
});

export function rulesHealth(rules: SparkRules): HealthItem[] {
  const user = rules.problems
    .filter((problem) => problem.file === 'user')
    .slice(rules.outsideChange ? 1 : 0);
  const company = rules.problems.filter((problem) => problem.file === 'managed');
  const items: HealthItem[] = [];
  if (rules.malformed) {
    items.push({
      key: 'rules:malformed',
      status: 'broken',
      title: 'settings.json can’t be used',
      detail: user[0] ? `${user[0].message}.` : null,
      fix: OPEN_RULES,
    });
  } else {
    for (const problem of user) {
      items.push({
        key: `rules:user:${problem.message}`,
        status: 'broken',
        title: 'Problem in settings.json',
        detail: problem.message,
        fix: OPEN_RULES,
      });
    }
  }
  for (const problem of company) {
    items.push({
      key: `rules:managed:${problem.message}`,
      status: 'broken',
      title: 'Problem in your company’s rules file',
      detail: problem.message,
      fix: OPEN_RULES,
    });
  }
  if (rules.outsideChange) {
    items.push({
      key: 'rules:outside',
      status: 'ignored',
      title: OUTSIDE_TITLE,
      detail: 'Spark keeps using the rules you last accepted until you choose.',
      fix: OPEN_RULES,
    });
  }
  if (rules.unused.length > 0) {
    items.push({
      key: 'rules:unused',
      status: 'ignored',
      title: unusedEntriesTitle(rules.unused.length),
      detail: rules.unused.map((entry) => entry.entry).join(', '),
      fix: OPEN_RULES,
    });
  }
  return items;
}

export function agentConfigHealth(project: Project, config: RepoAgentConfig): HealthItem[] {
  const items: HealthItem[] = config.warnings.map((warning) => ({
    key: `config:${project.id}:warning:${warning}`,
    status: 'broken',
    title: `${project.name}: a setting was skipped`,
    detail: warning,
    fix: AGENT_SETUP,
  }));
  if (config.trust.needed && config.trust.state === 'changed') {
    items.push({
      key: `config:${project.id}:trust`,
      status: 'ignored',
      title: `${project.name}: setup changed since you trusted it`,
      detail: 'Its hooks, allow rules and MCP servers stay off until you review the change.',
      fix: AGENT_SETUP,
    });
  }
  const ignored = ignoredCount(config);
  if (ignored > 0) {
    items.push({
      key: `config:${project.id}:ignored`,
      status: 'ignored',
      title: `${project.name}: ${countLabel(ignored, 'repo setting')} never applied`,
      detail: config.ignored
        .map((group) => `${IGNORED_LABELS[group.kind]} (${group.source})`)
        .join(', '),
      fix: AGENT_SETUP,
    });
  }
  return items;
}

export interface ProjectCheck {
  project: Project;
  config: RepoAgentConfig | undefined;
  error: Error | null;
}

export function projectsHealth(checks: readonly ProjectCheck[]): HealthItem[] {
  return checks.flatMap(({ project, config, error }) => {
    if (error) {
      return [
        {
          key: `config:${project.id}:error`,
          status: 'broken' as const,
          title: `${project.name}: couldn’t read its setup`,
          detail: error.message,
          fix: OPEN_PROJECTS,
        },
      ];
    }
    return config ? agentConfigHealth(project, config) : [];
  });
}

export function pluginsHealth(plugins: readonly UserPlugin[]): HealthItem[] {
  return plugins
    .filter((plugin) => !plugin.loadable)
    .map((plugin) => ({
      key: `plugin:${plugin.key}`,
      status: 'broken',
      title: `${plugin.name} can’t load in chats`,
      detail: unloadableText(plugin),
      fix: OPEN_PLUGINS,
    }));
}

function activeChat(chat: ConversationSummary): boolean {
  return chat.archivedAt === null && chat.assistant !== true;
}

export function terminalsHealth(chats: readonly ConversationSummary[]): HealthItem[] {
  return chats.filter(activeChat).flatMap((chat) => {
    const terminal = chat.terminal;
    const text = terminal?.mod ? terminalModText(terminal.mod) : null;
    if (!terminal || !text || terminalEnded(terminal)) return [];
    return [
      {
        key: `terminal:${terminal.id}`,
        status: 'ignored',
        title: chat.title,
        detail: text,
        fix: openChat(chat.id),
      },
    ];
  });
}

export function failedChatsHealth(chats: readonly ConversationSummary[]): HealthItem[] {
  return chats.filter(activeChat).flatMap((chat) => {
    const run = chat.latestRun;
    if (chat.sessionType === 'terminal' || run?.status !== 'failed' || !run.error) return [];
    return [
      {
        key: `failed:${run.id}`,
        status: 'broken',
        title: chat.title,
        detail: run.error,
        fix: openChat(chat.id),
      },
    ];
  });
}

export function providersHealth(providers: readonly ProviderSetup[]): HealthItem[] {
  return providers.flatMap((provider) => {
    const test = provider.connection?.lastTest;
    if (!test || test.ok) return [];
    return [
      {
        key: `provider:${provider.id}`,
        status: 'broken',
        title: `${provider.name} didn’t pass its last check`,
        detail: test.message,
        fix: OPEN_PROVIDERS,
      },
    ];
  });
}

export interface HelperStates {
  macControl: MacControlStatus | null;
  voice: VoiceStatus | null;
  calendar: CalendarStatus | null;
}

function missingHelper(name: string, command: string): HealthItem {
  return {
    key: `helper:${command}`,
    status: 'broken',
    title: `No ${name} helper in this build`,
    detail: null,
    fix: { kind: 'note', text: `From source, run pnpm ${command}.` },
  };
}

export function helpersHealth({ macControl, voice, calendar }: HelperStates): HealthItem[] {
  const items: HealthItem[] = [];
  if (macControl && macControlHelperMissing(macControl)) {
    items.push(missingHelper('Mac control', 'desktop:mac-control'));
  }
  if (voice && voice.helper !== 'ready') items.push(missingHelper('voice', 'desktop:voice'));
  if (calendar?.supported && macState(calendar) === 'helper') {
    items.push(missingHelper('calendar', 'desktop:calendar'));
  }
  return items;
}
