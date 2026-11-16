// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, RepoAgentConfig } from '@spark-outpost/contracts';

const state = vi.hoisted(() => ({
  config: null as unknown,
  allowed: true,
  mutate: vi.fn(),
}));
vi.mock('../project/use-agent-config.ts', () => ({
  useAgentConfig: () => ({ data: state.config }),
  useAgentConfigChange: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}));
vi.mock('../../phone/use-remote-client.ts', () => ({
  useRemoteClient: () => ({ allows: () => state.allowed }),
}));

const { ProjectTools } = await import('./ProjectTools.tsx');

const PROJECT = { id: '22222222-2222-4222-8222-222222222222', name: 'shop' } as Project;

function config(overrides: Partial<RepoAgentConfig>): RepoAgentConfig {
  return {
    settings: { instructions: true, skills: true, commands: false, subagents: true },
    instructions: [],
    skills: [],
    commands: [],
    subagents: [],
    ...overrides,
  } as RepoAgentConfig;
}

const skill = (name: string) => ({ name, description: '', path: `.claude/skills/${name}` });

afterEach(() => {
  cleanup();
  state.mutate.mockReset();
  state.allowed = true;
});

describe("the project's agent setup in the Tools panel", () => {
  it('lists only the parts the project has, with their names, and switches one', () => {
    state.config = config({
      skills: ['deploy', 'review', 'triage', 'release'].map(skill),
      commands: [skill('ship')],
    });
    render(<ProjectTools repos={[PROJECT]} />);

    expect(screen.getByText('Skills 4')).toBeTruthy();
    expect(screen.getByText('deploy, review, triage +1')).toBeTruthy();
    expect(screen.queryByText(/Subagents/)).toBeNull();
    expect(screen.queryByText(/Instructions/)).toBeNull();

    const commands = screen.getByRole('switch', { name: 'Use commands from shop' });
    expect(commands.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(commands);
    expect(state.mutate).toHaveBeenCalledWith({ type: 'settings', change: { commands: true } });
  });

  it('shows nothing for a project with no skills, commands, subagents or instructions', () => {
    state.config = config({});
    const { container } = render(<ProjectTools repos={[PROJECT]} />);
    expect(container.textContent).toBe('');
  });

  it('keeps the switches read only on a device without the settings switch', () => {
    state.config = config({ instructions: [{ path: 'AGENTS.md', bytes: 10, nested: false }] });
    state.allowed = false;
    render(<ProjectTools repos={[PROJECT]} />);
    const instructions = screen.getByRole('switch', { name: 'Follow instructions from shop' });
    expect((instructions as HTMLButtonElement).disabled).toBe(true);
  });
});
