// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Approval, SparkAction } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import { useSettingsRequests } from '../../settings/settings-request.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function card(action: SparkAction, title: string): Approval {
  return {
    id: '5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    runId: '6f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
    toolCallId: 'spark:create_ticket:1',
    kind: 'spark_action',
    title,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
    },
    payloadHash: 'sha256:abc',
    options: [
      { optionId: 'confirm', name: 'Create ticket', kind: 'allow_once' },
      { optionId: 'decline', name: 'Don’t', kind: 'reject_once' },
    ],
    status: 'pending',
    reason: null,
    decisionOptionId: null,
    scope: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-30T10:00:00.000Z',
  };
}

const create: SparkAction = {
  action: 'create_ticket',
  source: 'linear',
  project: 'ENG',
  title: 'Crash on save',
  description: 'Steps',
  type: null,
  priority: 'high',
  labels: ['bug'],
  assignToMe: true,
};

function show(approval: Approval) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalCard approval={approval} provider="claude" agent="Bolt" repo={null} />
    </QueryClientProvider>,
  );
}

function SettingsListener({ onOpen }: { onOpen: (section: string) => void }) {
  useSettingsRequests(onOpen);
  return null;
}

describe('SparkActionCard', () => {
  it('shows where the ticket goes and sends only the fields the user changed', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockResolvedValue({
      ...card(create, 'Create this ticket? Crash on save'),
      status: 'allowed',
      decisionOptionId: 'confirm',
      scope: 'once',
      decidedBy: 'user',
      decidedAt: '2026-09-30T10:01:00.000Z',
    });
    show(card(create, 'Create this ticket? Crash on save'));
    const group = screen.getByRole('group', { name: /Create this ticket\?/ });
    expect(group.textContent).toContain('Linear · ENG');
    expect(group.textContent).toContain('Nothing happens until you confirm');

    fireEvent.change(within(group).getByLabelText('Title'), {
      target: { value: 'Crash when saving' },
    });
    fireEvent.click(within(group).getByRole('button', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Urgent/ }));
    fireEvent.click(within(group).getByRole('button', { name: 'Create ticket' }));

    await waitFor(() => expect(decide).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d', {
      optionId: 'confirm',
      scope: 'once',
      payloadHash: 'sha256:abc',
      edits: { title: 'Crash when saving', priority: 'urgent' },
    });
  });

  it('declines without edits and warns before taking over someone else’s ticket', async () => {
    const decide = vi.spyOn(approvalsApi, 'decide').mockReturnValue(new Promise(() => undefined));
    show(
      card(
        {
          action: 'assign_ticket',
          ticket: { source: 'jira', key: 'WEB-4', title: 'Login', url: null },
          currentAssignee: 'Jordan Lee',
          currentAssigneeId: 'acc-2',
          to: 'me',
        },
        'Change who owns this ticket? WEB-4',
      ),
    );
    const group = screen.getByRole('group', { name: /Change who owns this ticket\?/ });
    expect(group.textContent).toContain(
      'WEB-4 is assigned to Jordan Lee. Confirming takes it over.',
    );
    expect(within(group).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(group).getByRole('button', { name: 'Don’t' }));

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('5f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d', {
        optionId: 'decline',
        scope: 'once',
        payloadHash: 'sha256:abc',
      }),
    );
  });

  it('shows the branch, base and files of a pull request', () => {
    show(
      card(
        {
          action: 'open_pr',
          taskId: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
          title: 'Tidy notes',
          body: 'Why',
          branch: 'spark/tidy-notes',
          base: 'main',
          repo: 'acme/widgets',
          files: [{ path: 'notes.txt', change: 'modified' }],
          moreFiles: 0,
        },
        'Open a pull request? Tidy notes',
      ),
    );
    const group = screen.getByRole('group', { name: /Open a pull request\?/ });
    expect(group.textContent).toContain('spark/tidy-notes into main');
    expect(group.textContent).toContain('notes.txt modified');
    expect(within(group).getByLabelText('Description')).toHaveProperty('value', 'Why');
  });

  it('shows the exact MCP command, the names that need values and no editable fields', () => {
    const opened = vi.fn();
    render(<SettingsListener onOpen={opened} />);
    show(
      card(
        {
          action: 'add_mcp_server',
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github', 'two words'],
          url: null,
          envNames: ['GITHUB_TOKEN'],
          headerNames: [],
          needsValues: ['GITHUB_TOKEN'],
          turnOn: 'off',
        },
        'Add this MCP server? github',
      ),
    );
    const group = screen.getByRole('group', { name: /Add this MCP server\?/ });
    expect(group.textContent).toContain('github · Command on your computer');
    expect(group.textContent).toContain("npx -y @modelcontextprotocol/server-github 'two words'");
    expect(group.textContent).toContain('This command runs on your computer');
    expect(group.textContent).toContain('Needs a value for GITHUB_TOKEN');
    expect(group.textContent).toContain('Off until you fill its values and turn it on');
    expect(group.textContent).toContain('new agent sessions');
    expect(group.textContent).not.toContain('You can edit it first');
    expect(within(group).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(group).getByRole('button', { name: 'Open MCP servers' }));
    expect(opened).toHaveBeenCalledWith('mcp');
  });

  it('says where an MCP server is switched and what a removal takes with it', () => {
    const server = {
      serverId: '8f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
      name: 'docs',
      transport: 'http' as const,
      command: null,
      args: [],
      url: 'https://mcp.example.com/v1',
      envNames: [],
      headerNames: ['Authorization'],
      needsValues: [],
    };
    show(
      card(
        {
          action: 'switch_mcp_server',
          ...server,
          fingerprint: 'sha256:abc',
          place: 'project',
          project: { id: '9f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d', name: 'webapp' },
          state: 'on',
        },
        'Switch this MCP server? docs',
      ),
    );
    const switching = screen.getByRole('group', { name: /Switch this MCP server\?/ });
    expect(switching.textContent).toContain('https://mcp.example.com/v1');
    expect(switching.textContent).toContain('Project webapp: on');
    expect(switching.textContent).not.toContain('runs on your computer');
    cleanup();

    show(card({ action: 'remove_mcp_server', ...server }, 'Remove this MCP server? docs'));
    const removing = screen.getByRole('group', { name: /Remove this MCP server\?/ });
    expect(removing.textContent).toContain('Removed with its saved values');
  });
});
