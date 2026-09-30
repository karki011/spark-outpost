import type { RepoAgentConfig } from '@spark-outpost/contracts';
import type { SetupItem } from './SetupCard.tsx';

export type KitKind = 'instructions' | 'skills' | 'commands' | 'subagents' | 'mcp';

export interface KitShelf {
  kind: KitKind;
  label: string;
  hue: number;
  on: boolean;
  items: SetupItem[];
}

const HUES: Record<KitKind, number> = {
  instructions: 38,
  skills: 150,
  commands: 262,
  subagents: 330,
  mcp: 195,
};

export function kitShelves(config: RepoAgentConfig): KitShelf[] {
  const definitions = (kind: 'skills' | 'commands' | 'subagents', label: string): KitShelf => ({
    kind,
    label,
    hue: HUES[kind],
    on: config.settings[kind],
    items: config[kind].map((item) => ({
      key: item.path,
      name: item.name,
      detail: item.description || undefined,
      path: item.path,
    })),
  });
  const shelves: KitShelf[] = [
    {
      kind: 'instructions',
      label: 'Instructions',
      hue: HUES.instructions,
      on: config.settings.instructions,
      items: config.instructions.map((file) => ({
        key: file.path,
        name: file.path,
        detail: file.nested ? 'Read when working in that folder' : undefined,
        path: file.path,
      })),
    },
    definitions('skills', 'Skills'),
    definitions('commands', 'Commands'),
    definitions('subagents', 'Subagents'),
    {
      kind: 'mcp',
      label: 'MCP servers',
      hue: HUES.mcp,
      on: config.mcpServers.some((server) => server.enabled),
      items: config.mcpServers.map((server) => ({
        key: server.name,
        name: server.name,
        detail: server.enabled ? 'On' : 'Off until you turn it on in Agent setup',
      })),
    },
  ];
  return shelves.filter((shelf) => shelf.items.length > 0);
}
