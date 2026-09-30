import { describe, expect, it } from 'vitest';
import type { RepoAgentConfig } from '@spark-outpost/contracts';
import { kitShelves } from './repo-kit.ts';

const config = {
  settings: {
    instructions: true,
    skills: false,
    commands: true,
    subagents: true,
    hooks: false,
    hooksChanged: false,
  },
  instructions: [
    { path: 'CLAUDE.md', nested: false },
    { path: 'libs/ui/CLAUDE.md', nested: true },
  ],
  skills: [{ name: 'add-provider', description: 'Adds one', path: '.claude/skills/add/SKILL.md' }],
  commands: [],
  subagents: [],
  mcpServers: [{ name: 'linear', enabled: false }],
} as unknown as RepoAgentConfig;

describe('kitShelves', () => {
  it('keeps only kinds the repo has, with openable paths', () => {
    const shelves = kitShelves(config);
    expect(shelves.map((shelf) => shelf.kind)).toEqual(['instructions', 'skills', 'mcp']);
    expect(shelves[0]!.items[1]).toMatchObject({
      path: 'libs/ui/CLAUDE.md',
      detail: 'Read when working in that folder',
    });
    expect(shelves[1]).toMatchObject({
      on: false,
      items: [{ path: '.claude/skills/add/SKILL.md' }],
    });
    expect(shelves[2]).toMatchObject({ on: false, items: [{ name: 'linear' }] });
    expect(shelves[2]!.items[0]!.path).toBeUndefined();
  });
});
