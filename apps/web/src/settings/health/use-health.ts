import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client.ts';
import { setupApi, setupKey } from '../../api/setup.ts';
import { useCalendarStatus } from '../../calendar/use-calendar.ts';
import { agentConfigQuery } from '../../chat/project/use-agent-config.ts';
import { useProjects } from '../../chat/project/use-chat-repos.ts';
import { usePageHidden } from '../../ui/use-page-hidden.ts';
import { desktopSpeech, useSpeechStatus } from '../../voice/speech-bridge.ts';
import { useMacControlStatus } from '../mac-control-status.ts';
import { useSparkRules } from '../spark-rules/use-spark-rules.ts';
import { useUserPlugins } from '../use-user-plugins.ts';
import { cloudflareApi, cloudflareKeys } from '../../cloudflare/cloudflare-api.ts';
import {
  cloudflareHealth,
  failedChatsHealth,
  helpersHealth,
  pluginsHealth,
  projectsHealth,
  providersHealth,
  rulesHealth,
  terminalsHealth,
  type HealthItem,
} from './health-model.ts';

const CLOUDFLARE_POLL_MS = 30_000;

export type HealthSourceState = 'checking' | 'failed' | 'ready';

export interface HealthSource {
  id: string;
  label: string;
  state: HealthSourceState;
  items: HealthItem[];
}

function stateOf(
  queries: readonly Pick<UseQueryResult, 'isPending' | 'isError'>[],
): HealthSourceState {
  if (queries.some((query) => query.isError)) return 'failed';
  if (queries.some((query) => query.isPending)) return 'checking';
  return 'ready';
}

function source<T>(
  id: string,
  label: string,
  query: UseQueryResult<T>,
  items: (data: T) => HealthItem[],
): HealthSource {
  const state = stateOf([query]);
  return { id, label, state, items: query.data === undefined ? [] : items(query.data) };
}

function useProjectsSource(): HealthSource {
  const projects = useProjects();
  const list = projects.data ?? [];
  const configs = useQueries({
    queries: list.map((project) => agentConfigQuery(project.id)),
  });
  const items = projectsHealth(
    list.map((project, index) => ({
      project,
      config: configs[index]?.data,
      error: configs[index]?.error ?? null,
    })),
  );
  const pending = configs.filter((config) => config.isPending);
  return { id: 'projects', label: 'Projects', state: stateOf([projects, ...pending]), items };
}

function useHelpersSource(): HealthSource {
  const macControl = useMacControlStatus();
  const calendar = useCalendarStatus();
  const voice = useSpeechStatus();
  const voicePending = desktopSpeech() !== null && voice === null;
  const state = stateOf([macControl, calendar]);
  return {
    id: 'helpers',
    label: 'Helpers',
    state: state === 'ready' && voicePending ? 'checking' : state,
    items: helpersHealth({
      macControl: macControl.data ?? null,
      voice,
      calendar: calendar.data ?? null,
    }),
  };
}

function useCloudflareSource(): HealthSource {
  const refetchInterval = usePageHidden() ? false : CLOUDFLARE_POLL_MS;
  const connection = useQuery({
    queryKey: cloudflareKeys.connection,
    queryFn: cloudflareApi.connection,
    refetchInterval,
  });
  const reach = useQuery({
    queryKey: cloudflareKeys.reach,
    queryFn: cloudflareApi.reach,
    refetchInterval,
  });
  return {
    id: 'cloudflare',
    label: 'Cloudflare',
    state: stateOf([connection, reach]),
    items: connection.data && reach.data ? cloudflareHealth(connection.data, reach.data) : [],
  };
}

export function useHealth(): HealthSource[] {
  const rules = useSparkRules();
  const plugins = useUserPlugins();
  const chats = useQuery({
    queryKey: queryKeys.healthConversations,
    queryFn: api.listHealthConversations,
  });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const projects = useProjectsSource();
  const helpers = useHelpersSource();
  const cloudflare = useCloudflareSource();
  return [
    source('rules', 'Spark rules', rules, rulesHealth),
    projects,
    source('plugins', 'Plugins', plugins, (data) => pluginsHealth(data.plugins)),
    source('terminals', 'Terminal sessions', chats, terminalsHealth),
    source('chats', 'Chats', chats, failedChatsHealth),
    source('providers', 'AI providers', setup, (data) => providersHealth(data.providers)),
    cloudflare,
    helpers,
  ];
}
