import '../../chat/project/agent-setup.css';
import './mcp.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SaveUserMcpRequest, UserMcpServer } from '@spark-outpost/contracts';
import { mcpApi } from '../../api/mcp.ts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { ToastHost } from '../../conversations/Toast.tsx';
import { useToast } from '../../conversations/use-toast.ts';
import { McpServerCard } from './McpServerCard.tsx';
import { McpServerForm } from './McpServerForm.tsx';
import { useMcpChange, useUserMcp } from './use-mcp.ts';

type Editing = { server: UserMcpServer | null } | null;

function SkeletonRows() {
  return (
    <div className="mcp-list" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="mcp-card mcp-skel">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

export function McpSection() {
  const list = useUserMcp();
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const toaster = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const remove = useMcpChange((id: string) => mcpApi.remove(id));
  const save = useMcpChange((body: SaveUserMcpRequest) =>
    editing?.server ? mcpApi.edit(editing.server.id, body) : mcpApi.add(body),
  );
  const servers = (list.data?.servers ?? []).filter((server) => !removing.has(server.id));

  const markRemoving = (id: string, on: boolean) =>
    setRemoving((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const removeServer = (server: UserMcpServer) => {
    markRemoving(server.id, true);
    remove.reset();
    toaster.show({
      text: `Removed ${server.name}`,
      undo: () => markRemoving(server.id, false),
      onSettle: () => remove.mutate(server.id, { onSettled: () => markRemoving(server.id, false) }),
    });
  };

  const saveServer = (body: SaveUserMcpRequest) =>
    save.mutate(body, {
      onSuccess: (saved) => {
        if (!editing?.server) {
          setOpenId(saved.servers.find((server) => server.name === body.name)?.id ?? null);
        }
        setEditing(null);
      },
    });

  return (
    <div className="mcp-section">
      <p className="lede">
        Add a server, or use Paste config in the form to bring one over from another app’s JSON.
        Servers start off. Turn one on for all chats, some projects, or one chat with /mcp; tool
        calls still ask first except at Full auto. Repo .mcp.json servers live in each project’s
        Agent setup.
      </p>
      <div className="mcp-actions">
        <button
          type="button"
          className="btn primary sm"
          onClick={() => {
            save.reset();
            setEditing({ server: null });
          }}
        >
          Add server
        </button>
      </div>
      {[remove.error, list.error].map(
        (error) =>
          error && (
            <p key={error.message} className="mcp-error" role="alert">
              {error.message}
            </p>
          ),
      )}
      {editing && (
        <McpServerForm
          key={editing.server?.id ?? 'new'}
          server={editing.server}
          busy={save.isPending}
          error={save.isError ? save.error.message : null}
          onCancel={() => setEditing(null)}
          onSave={saveServer}
        />
      )}
      {list.isPending && <SkeletonRows />}
      {list.data && servers.length === 0 && !editing && (
        <p className="mcp-empty">
          No MCP servers yet. Add one, or paste a config from another app.
        </p>
      )}
      <div className="mcp-list">
        {servers.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            projects={projects.data ?? []}
            open={openId === server.id}
            onToggle={() => setOpenId(openId === server.id ? null : server.id)}
            onEdit={(chosen) => {
              save.reset();
              setEditing({ server: chosen });
            }}
            onRemove={removeServer}
          />
        ))}
      </div>
      <div className="mcp-toasts">
        <ToastHost toaster={toaster} />
      </div>
    </div>
  );
}
