import {
  DEFAULT_INVOLVEMENT_LEVEL,
  EMPTY_CONVERSATION_USAGE,
  type AgentCommand,
  type AnnotationInput,
  type Attachment,
  type Run,
  type TaskOverview,
} from '@spark-outpost/contracts';
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { ChatHeaderMenu } from '../audit/ChatHeaderMenu.tsx';
import { AgentTvButton } from '../crew/AgentTvButton.tsx';
import { useSteer } from '../crew/use-steer.ts';
import {
  belongsTo,
  conversationCrew,
  crewOrchestration,
  latestOrchestration,
} from '../crew/conversation-crew.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { TerminalButton } from '../terminal/dock/TerminalButton.tsx';
import { TerminalDock } from '../terminal/dock/TerminalDock.tsx';
import { ThemePicker } from '../theme/ThemePicker.tsx';
import { PanelOpenContext } from '../tasks/panel-open.ts';
import { useTaskPanel } from '../tasks/work-panel-state.ts';
import { ViewChangesContext } from '../tasks/view-changes.ts';
import type { WorkTab } from '../tasks/TaskDetails.tsx';
import { WorkPanel } from '../tasks/WorkPanel.tsx';
import { WorkPanelToggle } from '../tasks/WorkPanelToggle.tsx';
import { DropOverlay } from './attachments/DropOverlay.tsx';
import { useAttachments } from './attachments/use-attachments.ts';
import { useFileDrop } from './attachments/use-file-drop.ts';
import { Composer } from './Composer.tsx';
import { ComposerStatus } from './status/ComposerStatus.tsx';
import { StatusContext } from './status/status-context.ts';
import { createStatusStore } from './status/status-store.ts';
import { providerName } from './provider-name.ts';
import { repoSummary } from './project/repo-list.ts';
import { useLinkedProjects } from './project/use-chat-repos.ts';
import { PrStatusCard } from './pull-request/PrStatusCard.tsx';
import { ChatTicketBar } from './tickets/ChatTicketBar.tsx';
import { ChatTicketChips } from './tickets/ChatTicketChips.tsx';
import { useChatTickets } from './tickets/use-chat-tickets.ts';
import { useChatWorkspace } from './project/use-chat-workspace.ts';
import { Thread } from './Thread.tsx';
import { useQuotes } from './quotes/use-quotes.ts';
import { activeRun } from './turns.ts';
import { FileSheetProvider } from './project/file-sheet/FileSheet.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { ChatTeammate } from '../teammates/ChatTeammate.tsx';
import { TalkToChip } from '../teammates/TalkToChip.tsx';

const NO_REPOS: string[] = [];
const NO_TASKS: TaskOverview[] = [];
const NO_COMMANDS: AgentCommand[] = [];
const NO_RUNS: Run[] = [];

export interface OutgoingMessage {
  content: string;
  attachments: Attachment[];
  annotations?: AnnotationInput[];
}

interface ChatViewProps {
  conversationId: string;
  onOpenChat: (conversationId: string) => void;
}

export function ChatView({ conversationId, onOpenChat }: ChatViewProps) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  });

  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const connected = setup.data?.providers.filter((provider) => provider.connection) ?? [];

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
    ]);

  const send = useMutation({
    mutationFn: (message: OutgoingMessage) =>
      api.sendMessage(
        conversationId,
        crypto.randomUUID(),
        message.content,
        message.attachments.map((attachment) => attachment.id),
        message.annotations,
      ),
    onSuccess: refresh,
  });
  const attachments = useAttachments();
  const latestReplyId =
    detail.data?.messages.findLast((message) => message.role === 'assistant')?.id ?? null;
  const quotes = useQuotes(conversationId, latestReplyId);
  const drop = useFileDrop(attachments.add);
  const stop = useMutation({ mutationFn: api.cancelRun, onSuccess: refresh });
  const startFresh = useMutation({
    mutationFn: () => api.startFreshSession(conversationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agentCommands(conversationId) }),
  });
  const commands = useQuery({
    queryKey: queryKeys.agentCommands(conversationId),
    queryFn: () => api.getAgentCommands(conversationId),
    enabled: (detail.data?.runs.length ?? 0) > 0,
  });

  const running = activeRun(detail.data);
  const title = detail.data?.conversation.title ?? '';
  const repos = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_REPOS);
  const settings = detail.data?.settings ?? null;
  const autonomyLevel =
    repos.length > 0 && settings ? (settings.level ?? DEFAULT_INVOLVEMENT_LEVEL) : null;
  const panel = useTaskPanel(detail.data?.tasks ?? NO_TASKS, autonomyLevel !== null);
  const crew = conversationCrew(detail.data);
  const orchestration = latestOrchestration(detail.data);
  const steer = useSteer(conversationId, running ? orchestration : null);
  const openTask = useStableCallback(panel.openTask);
  const openChat = useStableCallback(onOpenChat);
  const task = panel.task;
  const crewRun = crewOrchestration(detail.data);
  const taskCrew = task && crewRun && belongsTo(task, crewRun) ? crewRun : null;
  const [auditOpen, setAuditOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WorkTab>('tasks');
  const [autonomyRequest, setAutonomyRequest] = useState(0);
  const openAutonomy = () => {
    panel.setOpen(true);
    setAutonomyRequest((request) => request + 1);
  };
  const viewChanges = task
    ? (taskId?: string) => {
        setPanelTab('changes');
        if (taskId) panel.openTask(taskId);
        else panel.setOpen(true);
      }
    : null;
  const workspace = useChatWorkspace(conversationId, Boolean(detail.data?.conversation.branch));
  const chatBranch = workspace.data?.current ?? null;
  const canAudit = (detail.data?.runs.length ?? 0) > 0;
  const openAudit = canAudit ? () => setAuditOpen(true) : undefined;
  const tickets = useChatTickets(conversationId, (detail.data?.messages.length ?? 0) > 0);
  const [status] = useState(createStatusStore);
  const teammate = detail.data?.conversation.teammate ?? null;

  return (
    <ViewChangesContext value={viewChanges}>
      <StatusContext value={status}>
        <FileSheetProvider>
          <main className="main" {...drop.handlers}>
            <header className="head">
              <SidebarToggle />
              {repos.length > 0 && (
                <span className="crumb" title={repos.map((repo) => repo.rootPath).join('\n')}>
                  {repoSummary(repos.map((repo) => repo.name))} /
                </span>
              )}
              {detail.data && <ChatTeammate chat={detail.data.conversation} />}
              <h1
                className="chat-title"
                title={
                  detail.data?.conversation.titleSource === 'auto' ? 'Renamed by Spark' : undefined
                }
              >
                {title}
              </h1>
              <ChatTicketChips chat={tickets} />
              <div className="head-r">
                <WorkPanelToggle panel={panel} waiting={(task?.summary.waiting ?? 0) > 0} />
                {openAudit && (
                  <ChatHeaderMenu onAudit={openAudit} onStartFresh={() => startFresh.mutate()} />
                )}
                <AgentTvButton conversationId={conversationId} agents={crew} />
                <TerminalButton chatId={conversationId} />
                <ThemePicker />
              </div>
            </header>
            <ChatTicketBar chat={tickets} />
            <PrStatusCard conversationId={conversationId} />
            {detail.isError && !isConnectionLoss(detail.error) && (
              <p className="error-line" role="alert">
                {detail.error.message}
              </p>
            )}
            {detail.data ? (
              <PanelOpenContext value={panel.open}>
                <Thread
                  detail={detail.data}
                  repos={repos}
                  pendingMessage={send.isPending ? send.variables : null}
                  onOpenTask={openTask}
                  onOpenChat={openChat}
                  quotes={quotes}
                />
              </PanelOpenContext>
            ) : (
              <div className="thread-wrap" aria-busy={detail.isPending}>
                {detail.isPending && (
                  <LoadingBlob size="lg" className="thread-loading" line="Opening this chat…" />
                )}
              </div>
            )}
            {detail.data?.messages.length === 0 && (
              <TalkToChip conversationId={conversationId} teammate={teammate} />
            )}
            <ComposerStatus
              store={status}
              runs={detail.data?.runs ?? NO_RUNS}
              activeRunId={running?.id ?? null}
              provider={detail.data?.settings.provider ?? ''}
            />
            <Composer
              conversationId={conversationId}
              repos={repos}
              settings={settings}
              providers={connected}
              runs={detail.data?.runs ?? []}
              orchestration={orchestration}
              usageTotals={detail.data?.usageTotals ?? EMPTY_CONVERSATION_USAGE}
              busy={running !== null}
              sending={send.isPending}
              error={send.error?.message ?? stop.error?.message ?? null}
              attachments={attachments}
              quotes={quotes}
              onSend={async (content, files, annotations) => {
                await send.mutateAsync({ content, attachments: files, annotations });
              }}
              onStop={() => {
                if (running) stop.mutate(running.id);
              }}
              steer={steer}
              {...(openAudit ? { onAudit: openAudit } : {})}
              onStartFresh={() => startFresh.mutate()}
              autonomy={autonomyLevel ? { level: autonomyLevel, onOpen: openAutonomy } : null}
              agentCommands={commands.data?.commands ?? NO_COMMANDS}
              agentName={providerName(
                commands.data?.provider ?? detail.data?.settings.provider ?? '',
              )}
            />
            <TerminalDock chatId={conversationId} />
            <DropOverlay visible={drop.dragging} />
          </main>
          {panel.available && (
            <WorkPanel
              conversationId={conversationId}
              task={task}
              autonomy={
                autonomyLevel ? { level: autonomyLevel, focusRequest: autonomyRequest } : null
              }
              open={panel.open}
              wide={panel.wide}
              tab={panelTab}
              onTab={setPanelTab}
              onClose={() => panel.setOpen(false)}
              orchestration={taskCrew}
              agents={taskCrew ? crew : []}
              roots={[
                ...(chatBranch?.worktree ? [chatBranch.path] : []),
                ...repos.map((repo) => repo.rootPath),
              ]}
              runs={detail.data?.runs ?? []}
              width={panel.width}
              onWidth={panel.setWidth}
              {...(openAudit ? { onAudit: openAudit } : {})}
            />
          )}
          <AnimatePresence>
            {auditOpen && (
              <AuditDialog
                conversationId={conversationId}
                title={title}
                onClose={() => setAuditOpen(false)}
              />
            )}
          </AnimatePresence>
        </FileSheetProvider>
      </StatusContext>
    </ViewChangesContext>
  );
}
