import type { ReactNode } from 'react';
import type { RemoteSwitch, SetupState } from '@spark-outpost/contracts';
import { CALENDAR_BRIEF_LABEL, CALENDAR_NOTIFY_ROWS } from '../calendar/CalendarNotifySettings.tsx';
import { ModelsSection } from '../models/ModelsSection.tsx';
import { ConnectorGrid } from '../onboarding/ToolsStep.tsx';
import { ProviderSetupView } from '../providers/ProviderSetupView.tsx';
import { routeToProvider, useRoutedProvider } from '../providers/provider-route.ts';
import { APPEARANCE_ROWS, AppearanceSettings } from '../theme/AppearanceSettings.tsx';
import { UsageSection } from '../usage/UsageSection.tsx';
import { ProfileSection } from '../spark/ProfileSection.tsx';
import { ASSISTANT_ROWS, SparkAssistantSection } from './assistant/SparkAssistantSection.tsx';
import { NAME_LABEL, PERSONALITY_LABEL } from '../spark/SparkSettings.tsx';
import { LEVEL_LABEL } from './setting-labels.ts';
import { COMPACT_LABEL, WARN_LABEL } from '../spark/CompactionSettings.tsx';
import { INSTRUCTIONS_LABEL } from '../spark/AgentInstructionsSetting.tsx';
import { MORNING_BRIEF_LABEL } from '../spark/MorningBriefSetting.tsx';
import { ResetSection, KEEP_KEYS_LABEL } from '../reset/ResetSection.tsx';
import { HelpSection, helpRows } from '../help/HelpSection.tsx';
import { AUTO_CONTINUE_LABEL } from './AutoContinueSetting.tsx';
import { ARCHIVE_INACTIVE_LABEL } from './ArchiveInactiveSetting.tsx';
import { CODE_MODE_LABEL } from './CodeModeSetting.tsx';
import { PLUGINS_LABEL } from './PluginsSettings.tsx';
import { COLLAPSE_TURNS_LABEL } from './CollapseTurnsSetting.tsx';
import { BUSY_ENTER_LABEL } from './BusyEnterSetting.tsx';
import { BrowserSection, SIGNED_IN_SITES_LABEL, SIGN_OUT_ALL_LABEL } from './BrowserSection.tsx';
import { CLEAR_HISTORY_LABEL } from './BrowserHistorySetting.tsx';
import { ARCHIVE_LABEL } from './BrowserArchiveSetting.tsx';
import { LINKS_IN_LABEL } from './BrowserLinksSetting.tsx';
import { SEARCH_ENGINE_LABEL } from './BrowserSearchSetting.tsx';
import { ChatsSection } from './ChatsSection.tsx';
import { REPOS_FOLDERS_LABEL } from './ReposFoldersSetting.tsx';
import { COMPANION_LABEL } from './CompanionSetting.tsx';
import { islandRows } from './DesktopCompanionSetting.tsx';
import { MAC_CONTROL_LABEL, MacControlSection } from './MacControlSection.tsx';
import { McpSection } from './mcp/McpSection.tsx';
import { NotificationsSection } from './NotificationsSection.tsx';
import { PRIVACY_SCREEN_ROWS, PrivacyScreenSection } from './PrivacyScreenSection.tsx';
import { ProjectsSection } from './ProjectsSection.tsx';
import { GithubSection, githubRows } from './GithubSection.tsx';
import { SPARK_RULES_ROWS } from './spark-rules/rule-rows.ts';
import { SparkRulesSection } from './spark-rules/SparkRulesSection.tsx';
import { TERMINAL_RECORD_LABEL } from './TerminalRecordSetting.tsx';
import { UPDATE_ROWS, UpdatesSection } from './UpdatesSection.tsx';
import { VOICE_ROWS, VoiceSection } from './VoiceSection.tsx';
import { WIDE_WINDOW_LABEL } from './WideWindowSetting.tsx';
import * as icons from './settings-icons.tsx';
import { sectionAvailable, type SettingsPage, type SettingsSection } from './section-ids.ts';

export const SETTINGS_GROUPS = [
  { id: 'general', title: 'General' },
  { id: 'agents', title: 'Agents' },
  { id: 'work', title: 'Work' },
  { id: 'connections', title: 'Connections' },
  { id: 'app', title: 'App' },
] as const;

type SettingsGroup = (typeof SETTINGS_GROUPS)[number]['id'];

interface SectionBodyProps {
  setup: SetupState | undefined;
  off: boolean;
  onOpenChat: (conversationId: string) => void;
}

export interface SettingsClient {
  remote: boolean;
  calendar: boolean;
}

export interface SettingsPartEntry {
  id: SettingsSection;
  title: string;
  remoteSwitch?: RemoteSwitch | undefined;
  rows?: ((client: SettingsClient) => readonly string[]) | undefined;
  render: (props: SectionBodyProps) => ReactNode;
}

export interface SettingsSectionEntry {
  id: SettingsPage;
  group: SettingsGroup;
  label: string;
  icon: ReactNode;
  remoteSwitch?: RemoteSwitch;
  rows?: (client: SettingsClient) => readonly string[];
  render?: (props: SectionBodyProps) => ReactNode;
  parts?: readonly SettingsPartEntry[];
  tabs?: boolean;
}

function ProvidersBody({ setup }: { setup: SetupState }) {
  const routedProvider = useRoutedProvider();
  return (
    <>
      <p className="lede">
        Connect Claude, Codex or both. Open one to set it up, test it or change its defaults.
      </p>
      <ProviderSetupView
        density="compact"
        providers={setup.providers}
        advisors={setup.advisors}
        defaultProvider={setup.profile.defaultProvider}
        openId={routedProvider}
        onOpenChange={routeToProvider}
      />
    </>
  );
}

const CONNECTORS_LEDE =
  'GitHub lets Ship open pull requests and Spark follow up on them. Jira and Linear bring your tickets into Spark. Slack notifies you, shares threads as context and takes updates.';

export const SETTINGS_SECTIONS = [
  {
    id: 'spark',
    group: 'general',
    label: 'General',
    icon: icons.PROFILE_ICON,
    parts: [
      {
        id: 'spark',
        title: 'Profile & personality',
        remoteSwitch: 'settings',
        rows: () => [NAME_LABEL, PERSONALITY_LABEL],
        render: ({ setup }) => setup && <ProfileSection setup={setup} />,
      },
      {
        id: 'look',
        title: 'Appearance',
        rows: () => APPEARANCE_ROWS,
        render: () => (
          <>
            <p className="lede">
              Follows your system by default. Changes apply everywhere right away.
            </p>
            <AppearanceSettings />
          </>
        ),
      },
      {
        id: 'lock',
        title: 'Privacy screen',
        rows: ({ remote }) => (remote ? [] : PRIVACY_SCREEN_ROWS),
        render: () => <PrivacyScreenSection />,
      },
    ],
  },
  {
    id: 'assistant',
    group: 'general',
    label: 'Spark assistant',
    icon: icons.ASSISTANT_ICON,
    remoteSwitch: 'settings',
    rows: () => ASSISTANT_ROWS,
    render: ({ setup, onOpenChat }) =>
      setup && <SparkAssistantSection setup={setup} onOpenChat={onOpenChat} />,
  },
  {
    id: 'voice',
    group: 'general',
    label: 'Voice',
    icon: icons.VOICE_ICON,
    rows: () => VOICE_ROWS,
    render: () => <VoiceSection />,
  },
  {
    id: 'notifications',
    group: 'general',
    label: 'Notifications',
    icon: icons.NOTIFICATIONS_ICON,
    remoteSwitch: 'settings',
    rows: ({ calendar }) => [
      MORNING_BRIEF_LABEL,
      ...(calendar ? [CALENDAR_BRIEF_LABEL] : []),
      COMPANION_LABEL,
      ...(calendar ? CALENDAR_NOTIFY_ROWS : []),
      ...islandRows(),
    ],
    render: ({ setup }) => setup && <NotificationsSection profile={setup.profile} />,
  },
  {
    id: 'ai',
    group: 'agents',
    label: 'AI providers',
    icon: icons.PROVIDERS_ICON,
    tabs: true,
    parts: [
      {
        id: 'ai',
        title: 'Providers',
        remoteSwitch: 'connections',
        render: ({ setup }) => setup && <ProvidersBody setup={setup} />,
      },
      {
        id: 'models',
        title: 'Models',
        remoteSwitch: 'settings',
        render: () => <ModelsSection />,
      },
    ],
  },
  {
    id: 'usage',
    group: 'agents',
    label: 'Usage',
    icon: icons.USAGE_ICON,
    render: () => <UsageSection />,
  },
  {
    id: 'projects',
    group: 'work',
    label: 'Projects',
    icon: icons.PROJECTS_ICON,
    remoteSwitch: 'settings',
    rows: () => [REPOS_FOLDERS_LABEL],
    render: () => <ProjectsSection />,
  },
  {
    id: 'chats',
    group: 'work',
    label: 'Chats & autonomy',
    icon: icons.CHATS_ICON,
    remoteSwitch: 'settings',
    rows: () => [
      LEVEL_LABEL,
      AUTO_CONTINUE_LABEL,
      WARN_LABEL,
      COMPACT_LABEL,
      BUSY_ENTER_LABEL,
      WIDE_WINDOW_LABEL,
      COLLAPSE_TURNS_LABEL,
      ARCHIVE_INACTIVE_LABEL,
      CODE_MODE_LABEL,
      INSTRUCTIONS_LABEL,
      TERMINAL_RECORD_LABEL,
      PLUGINS_LABEL,
    ],
    render: ({ setup }) => setup && <ChatsSection profile={setup.profile} />,
  },
  {
    id: 'pulls',
    group: 'work',
    label: 'GitHub',
    icon: icons.PULL_REQUESTS_ICON,
    remoteSwitch: 'settings',
    rows: githubRows,
    render: ({ setup }) => setup && <GithubSection profile={setup.profile} />,
  },
  {
    id: 'rules',
    group: 'work',
    label: 'Spark rules',
    icon: icons.SPARK_RULES_ICON,
    rows: () => SPARK_RULES_ROWS,
    render: () => <SparkRulesSection />,
  },
  {
    id: 'tools',
    group: 'connections',
    label: 'Connectors',
    icon: icons.CONNECTORS_ICON,
    tabs: true,
    parts: [
      {
        id: 'tools',
        title: 'Connectors',
        remoteSwitch: 'connections',
        render: () => (
          <>
            <p className="lede">{CONNECTORS_LEDE}</p>
            <ConnectorGrid paged />
          </>
        ),
      },
      {
        id: 'mcp',
        title: 'MCP servers',
        remoteSwitch: 'connections',
        render: ({ off }) => !off && <McpSection />,
      },
    ],
  },
  {
    id: 'browser',
    group: 'connections',
    label: 'Browser pane',
    icon: icons.BROWSER_ICON,
    rows: () => [
      LINKS_IN_LABEL,
      SIGNED_IN_SITES_LABEL,
      SIGN_OUT_ALL_LABEL,
      SEARCH_ENGINE_LABEL,
      ARCHIVE_LABEL,
      CLEAR_HISTORY_LABEL,
    ],
    render: () => <BrowserSection />,
  },
  {
    id: 'mac',
    group: 'connections',
    label: 'Mac control',
    icon: icons.MAC_CONTROL_ICON,
    rows: () => [MAC_CONTROL_LABEL],
    render: ({ setup }) => setup && <MacControlSection profile={setup.profile} />,
  },
  {
    id: 'about',
    group: 'app',
    label: 'About',
    icon: icons.HELP_ICON,
    parts: [
      {
        id: 'updates',
        title: 'Updates',
        rows: () => UPDATE_ROWS,
        render: () => <UpdatesSection />,
      },
      {
        id: 'help',
        title: 'Help',
        rows: helpRows,
        render: () => <HelpSection />,
      },
      {
        id: 'reset',
        title: 'Reset',
        remoteSwitch: 'reset',
        rows: () => [KEEP_KEYS_LABEL],
        render: () => <ResetSection />,
      },
    ],
  },
] as const satisfies readonly SettingsSectionEntry[];

export type { SettingsSection };

const ALL_SECTIONS: readonly SettingsSectionEntry[] = SETTINGS_SECTIONS;

export function partsOf(entry: SettingsSectionEntry): SettingsPartEntry[] {
  if (entry.parts) return entry.parts.filter((part) => sectionAvailable(part.id));
  return [
    {
      id: entry.id,
      title: entry.label,
      remoteSwitch: entry.remoteSwitch,
      rows: entry.rows,
      render: entry.render ?? (() => null),
    },
  ];
}

export function availableSections(): SettingsSectionEntry[] {
  return ALL_SECTIONS.filter((entry) => sectionAvailable(entry.id));
}

export function groupTitle(group: SettingsGroup): string {
  return SETTINGS_GROUPS.find((entry) => entry.id === group)!.title;
}
