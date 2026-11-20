import type { AgentConfigSwitch, Project, RepoAgentConfig } from '@spark-outpost/contracts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { SetupSwitch } from '../project/SetupCard.tsx';
import { useAgentConfig, useAgentConfigChange } from '../project/use-agent-config.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { RailOffWord, ToolsGroupFrame, ToolText, useRailGroups } from './ToolsGroupFrame.tsx';

const PARTS: readonly { key: AgentConfigSwitch; title: string }[] = [
  { key: 'skills', title: 'Skills' },
  { key: 'commands', title: 'Commands' },
  { key: 'subagents', title: 'Subagents' },
  { key: 'instructions', title: 'Instructions' },
];

const NAMES_SHOWN = 3;

function partNames(config: RepoAgentConfig, key: AgentConfigSwitch): string[] {
  if (key === 'instructions') return config.instructions.map((file) => file.path);
  return config[key].map((item) => item.name);
}

function namesLine(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const more = names.length - NAMES_SHOWN;
  return more > 0 ? `${shown} +${more}` : shown;
}

function RepoParts({ project }: { project: Project }) {
  const config = useAgentConfig(project.id);
  const change = useAgentConfigChange(project.id);
  const { allows } = useRemoteClient();
  const rail = useRailGroups();
  const frame = {
    groupKey: `project:${project.id}`,
    kind: 'project',
    title: project.name,
    scope: 'this project',
  } as const;
  if (!config.data) {
    const wait = (
      <QueryWait query={config} what={`agent setup for ${project.name}`}>
        <Skeleton label={`Loading agent setup for ${project.name}`} shape="list" rows={2} />
      </QueryWait>
    );
    if (!rail) return wait;
    return (
      <ToolsGroupFrame {...frame} summary={null}>
        {wait}
      </ToolsGroupFrame>
    );
  }
  const data = config.data;
  const parts = PARTS.filter(({ key }) => partNames(data, key).length > 0);
  if (parts.length === 0) return null;
  const on = parts.filter(({ key }) => data.settings[key]).length;
  return (
    <ToolsGroupFrame {...frame} summary={`${on} of ${parts.length} on`}>
      <ul aria-label={`Agent setup for ${project.name}`}>
        {parts.map(({ key, title }) => {
          const names = partNames(data, key);
          const line = namesLine(names);
          return (
            <li key={key}>
              <ToolText name={`${title} ${names.length}`} note={line} full={names.join(', ')} />
              <RailOffWord checked={data.settings[key]} />
              <SetupSwitch
                label={`${key === 'instructions' ? 'Follow' : 'Use'} ${key} from ${project.name}`}
                checked={data.settings[key]}
                disabled={change.isPending || !allows('settings')}
                onChange={(checked) =>
                  change.mutate({ type: 'settings', change: { [key]: checked } })
                }
              />
            </li>
          );
        })}
      </ul>
      {change.isError && (
        <p className="mcp-error" role="alert">
          {change.error.message}
        </p>
      )}
    </ToolsGroupFrame>
  );
}

export function ProjectTools({ repos }: { repos: readonly Project[] }) {
  return (
    <>
      {repos.map((project) => (
        <RepoParts key={project.id} project={project} />
      ))}
    </>
  );
}
