// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, UserMcpServer } from '@spark-outpost/contracts';

const added = vi.hoisted(() => ({ onAdded: null as ((project: Project) => void) | null }));
vi.mock('../../projects/use-add-folder.tsx', () => ({
  useAddFolder: ({ onAdded }: { onAdded: (project: Project) => void }) => {
    added.onAdded = onAdded;
    return {
      actions: [{ id: 'add-folder', label: 'Add folder…', onSelect: vi.fn() }],
      flow: null,
    };
  },
}));

const { McpProjectOverrides } = await import('./McpProjectOverrides.tsx');

afterEach(cleanup);

const SERVER: UserMcpServer = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'user',
  name: 'docs',
  transport: 'stdio',
  command: 'docs-mcp',
  args: [],
  url: null,
  envNames: [],
  headerNames: [],
  secretNames: [],
  fingerprint: 'f',
  global: null,
  projects: [],
  check: null,
} as unknown as UserMcpServer;

const PROJECT: Project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'shop',
  rootPath: '/Users/maya/shop',
  displayPath: '~/shop',
  createdAt: '2026-10-01T00:00:00Z',
  commandAllowlist: [],
};

describe('McpProjectOverrides', () => {
  it('offers Add folder even with no projects, and picks the folder it adds', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <McpProjectOverrides server={SERVER} projects={[]} busy={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Different in a project' }));
    expect(screen.getByRole('menuitem', { name: 'Add folder…' })).toBeTruthy();

    rerender(
      <McpProjectOverrides server={SERVER} projects={[PROJECT]} busy={false} onChange={onChange} />,
    );
    act(() => added.onAdded!(PROJECT));
    rerender(
      <McpProjectOverrides server={SERVER} projects={[PROJECT]} busy={false} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Different in a project' }).textContent).toContain(
      'shop',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn on there' }));
    expect(onChange).toHaveBeenCalledWith({
      scope: 'project',
      scopeId: PROJECT.id,
      enabled: true,
      fingerprint: 'f',
    });
  });
});
