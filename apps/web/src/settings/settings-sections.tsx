import type { ReactNode } from 'react';
import type { RemoteSwitch, SetupState } from '@spark-outpost/contracts';
import { ModelsSection } from '../models/ModelsSection.tsx';
import { ConnectorGrid } from '../onboarding/ToolsStep.tsx';
import { ProviderSetupView } from '../providers/ProviderSetupView.tsx';
import { routeToProvider, useRoutedProvider } from '../providers/provider-route.ts';
import { ThemeCards } from '../theme/ThemeCards.tsx';
import { UsageSection } from '../usage/UsageSection.tsx';
import { ProfileSection } from '../spark/ProfileSection.tsx';
import { ASSISTANT_ROWS, SparkAssistantSection } from './assistant/SparkAssistantSection.tsx';
import { NAME_LABEL, PERSONALITY_LABEL } from '../spark/SparkSettings.tsx';
import { LEVEL_LABEL } from '../spark/LevelSetting.tsx';
import { COMPACT_LABEL, WARN_LABEL } from '../spark/CompactionSettings.tsx';
import { INSTRUCTIONS_LABEL } from '../spark/AgentInstructionsSetting.tsx';
import { MORNING_BRIEF_LABEL } from '../spark/MorningBriefSetting.tsx';
import { SparksSection } from '../teammates/SparksSection.tsx';
import { ResetSection, KEEP_KEYS_LABEL } from '../reset/ResetSection.tsx';
import { HelpSection, helpRows } from '../help/HelpSection.tsx';
import { AUTO_CONTINUE_LABEL } from './AutoContinueSetting.tsx';
import { BUSY_ENTER_LABEL } from './BusyEnterSetting.tsx';
import { ChatsSection } from './ChatsSection.tsx';
import { COMPANION_LABEL } from './CompanionSetting.tsx';
import { islandRows } from './DesktopCompanionSetting.tsx';
import { MAC_CONTROL_LABEL, MacControlSection, macControlAvailable } from './MacControlSection.tsx';
import { McpSection } from './mcp/McpSection.tsx';
import { NotificationsSection } from './NotificationsSection.tsx';
import { ProjectsSection } from './ProjectsSection.tsx';
import { PULL_REQUEST_ROWS, PullRequestsSection } from './PullRequestSettings.tsx';
import { TERMINAL_RECORD_LABEL } from './TerminalRecordSetting.tsx';
import { UPDATE_ROWS, UpdatesSection, updatesAvailable } from './UpdatesSection.tsx';
import { WIDE_WINDOW_LABEL } from './WideWindowSetting.tsx';
import * as icons from './settings-icons.tsx';

export const SETTINGS_GROUPS = [
  { id: 'general', title: 'General' },
  { id: 'agents', title: 'Agents' },
  { id: 'work', title: 'Work' },
  { id: 'connections', title: 'Connections' },
  { id: 'mac', title: 'Mac' },
  { id: 'app', title: 'App' },
] as const;

type SettingsGroup = (typeof SETTINGS_GROUPS)[number]['id'];

interface SectionBodyProps {
  setup: SetupState | undefined;
  off: boolean;
  onOpenChat: (conversationId: string) => void;
}

interface SectionEntry {
  id: string;
  group: SettingsGroup;
  label: string;
  icon: ReactNode;
  remoteSwitch?: RemoteSwitch;
  available?: () => boolean;
  rows?: (client: { remote: boolean }) => readonly string[];
  render: (props: SectionBodyProps) => ReactNode;
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
    label: 'Profile & personality',
    icon: icons.PROFILE_ICON,
    remoteSwitch: 'settings',
    rows: () => [NAME_LABEL, PERSONALITY_LABEL],
    render: ({ setup }) => setup && <ProfileSection setup={setup} />,
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
    id: 'look',
    group: 'general',
    label: 'Appearance',
    icon: icons.APPEARANCE_ICON,
    render: () => (
      <>
        <p className="lede">Pick a theme. It applies everywhere right away.</p>
        <ThemeCards />
      </>
    ),
  },
  {
    id: 'ai',
    group: 'agents',
    label: 'AI providers',
    icon: icons.PROVIDERS_ICON,
    remoteSwitch: 'connections',
    render: ({ setup }) => setup && <ProvidersBody setup={setup} />,
  },
  {
    id: 'models',
    group: 'agents',
    label: 'Models',
    icon: icons.MODELS_ICON,
    remoteSwitch: 'settings',
    render: () => <ModelsSection />,
  },
  {
    id: 'sparks',
    group: 'agents',
    label: 'Crew',
    icon: icons.CREW_ICON,
    remoteSwitch: 'settings',
    render: () => <SparksSection />,
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
      INSTRUCTIONS_LABEL,
      TERMINAL_RECORD_LABEL,
    ],
    render: ({ setup }) => setup && <ChatsSection profile={setup.profile} />,
  },
  {
    id: 'pulls',
    group: 'work',
    label: 'Pull requests',
    icon: icons.PULL_REQUESTS_ICON,
    remoteSwitch: 'settings',
    rows: () => PULL_REQUEST_ROWS,
    render: ({ setup }) => setup && <PullRequestsSection profile={setup.profile} />,
  },
  {
    id: 'tools',
    group: 'connections',
    label: 'Connectors',
    icon: icons.CONNECTORS_ICON,
    remoteSwitch: 'connections',
    render: () => (
      <>
        <p className="lede">{CONNECTORS_LEDE}</p>
        <ConnectorGrid />
      </>
    ),
  },
  {
    id: 'mcp',
    group: 'connections',
    label: 'MCP servers',
    icon: icons.MCP_ICON,
    remoteSwitch: 'connections',
    render: ({ off }) => !off && <McpSection />,
  },
  {
    id: 'mac',
    group: 'mac',
    label: 'Mac control',
    icon: icons.MAC_CONTROL_ICON,
    available: macControlAvailable,
    rows: () => [MAC_CONTROL_LABEL],
    render: ({ setup }) => setup && <MacControlSection profile={setup.profile} />,
  },
  {
    id: 'notifications',
    group: 'mac',
    label: 'Notifications',
    icon: icons.NOTIFICATIONS_ICON,
    remoteSwitch: 'settings',
    rows: () => [MORNING_BRIEF_LABEL, COMPANION_LABEL, ...islandRows()],
    render: ({ setup }) => setup && <NotificationsSection profile={setup.profile} />,
  },
  {
    id: 'updates',
    group: 'app',
    label: 'Updates',
    icon: icons.UPDATES_ICON,
    available: updatesAvailable,
    rows: () => UPDATE_ROWS,
    render: () => <UpdatesSection />,
  },
  {
    id: 'help',
    group: 'app',
    label: 'Help',
    icon: icons.HELP_ICON,
    rows: helpRows,
    render: () => <HelpSection />,
  },
  {
    id: 'reset',
    group: 'app',
    label: 'Reset',
    icon: icons.RESET_ICON,
    remoteSwitch: 'reset',
    rows: () => [KEEP_KEYS_LABEL],
    render: () => <ResetSection />,
  },
] as const satisfies readonly SectionEntry[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

export type SettingsSectionEntry = SectionEntry & { id: SettingsSection };

const ALL_SECTIONS: readonly SettingsSectionEntry[] = SETTINGS_SECTIONS;

export function availableSections(): SettingsSectionEntry[] {
  return ALL_SECTIONS.filter((entry) => entry.available?.() ?? true);
}

export function groupTitle(group: SettingsGroup): string {
  return SETTINGS_GROUPS.find((entry) => entry.id === group)!.title;
}
