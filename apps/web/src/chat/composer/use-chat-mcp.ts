import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMcpServer, McpEnableRequest } from '@spark-outpost/contracts';
import { chatMcpKey, mcpApi, userMcpKey } from '../../api/mcp.ts';
import { checkLine, sourceLabel } from '../../settings/mcp/mcp-labels.ts';

export type ChatMcpUserServer = Extract<ChatMcpServer, { kind: 'user' }>;
export type ChatMcpProjectServer = Extract<ChatMcpServer, { kind: 'project' }>;

const VIA_LABELS: Record<ChatMcpUserServer['via'], string> = {
  chat: 'set for this chat',
  project: 'from the project setting',
  global: 'from the all-chats setting',
  off: 'off by default',
};

export function userServerDetail(server: ChatMcpUserServer): string {
  const parts = [sourceLabel(server.source), VIA_LABELS[server.via]];
  if (server.changed) parts.push('changed, review it in Settings');
  else parts.push(checkLine(server.check, server.fingerprint));
  return parts.join(' · ');
}

function projectState(server: ChatMcpProjectServer): string {
  if (server.changed) return 'changed, review it in Agent setup';
  return server.enabled ? 'on' : 'off';
}

export function projectServerDetail(server: ChatMcpProjectServer): string {
  return `${server.projectName} repo · ${projectState(server)}`;
}

export function useChatMcp(conversationId: string) {
  const queryClient = useQueryClient();
  const servers = useQuery({
    queryKey: chatMcpKey(conversationId),
    queryFn: () => mcpApi.forChat(conversationId),
  });
  const toggle = useMutation({
    mutationFn: ({ id, body }: { id: string; body: McpEnableRequest }) => mcpApi.enable(id, body),
    onSuccess: (list) => {
      queryClient.setQueryData(userMcpKey, list);
      return queryClient.invalidateQueries({ queryKey: chatMcpKey(conversationId) });
    },
  });
  const setForChat = (server: ChatMcpUserServer, enabled: boolean | null) =>
    toggle.mutate({
      id: server.id,
      body: enabled
        ? { scope: 'chat', scopeId: conversationId, enabled: true, fingerprint: server.fingerprint }
        : { scope: 'chat', scopeId: conversationId, enabled },
    });
  return { servers, toggle, setForChat };
}
