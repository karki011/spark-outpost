import {
  DEFAULT_INVOLVEMENT_LEVEL,
  DEFAULT_BUSY_ENTER,
  DEFAULT_WIDE_WINDOW,
  EMPTY_CONVERSATION_USAGE,
  type AgentCommand,
  type ChangeEntry,
  type Run,
  type TaskOverview,
} from '@spark-outpost/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { DiffChip } from '../diff/DiffChip.tsx';
import { DiffDrawerHost, useDiffDrawer } from '../diff/DiffDrawerHost.tsx';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { ChatHeaderMenu } from '../audit/ChatHeaderMenu.tsx';
import { AgentTvButton } from '../crew/AgentTvButton.tsx';
import { useSteer } from '../crew/use-steer.ts';
import {
  belongsTo,
  conversationCrew,
  crewOrchestration,
  latestOrchestration,
  tvCrew,
} from '../crew/conversation-crew.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { BrowserButton } from '../browser/BrowserButton.tsx';
import { BrowserPane } from '../browser/BrowserPane.tsx';
import { browserAvailable, onBrowserPick } from '../browser/browser-store.ts';
import { pickFiles } from '../browser/pick-files.ts';
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
import { ChatRail } from './rail/ChatRail.tsx';
import { RailContext } from './rail/rail-context.ts';
import { useRailCollapsed, useRoomy } from './rail/use-rail-layout.ts';
import { panelOpensByDefault, railState } from './rail/wide-layout.ts';
import { Thread } from './Thread.tsx';
import { useQuotes } from './quotes/use-quotes.ts';
import { useChatSend } from './send/use-chat-send.ts';
import { QueueStrip } from './queue/QueueStrip.tsx';
import { sendNowStatus } from './queue/send-choice.ts';
import { queueMode } from './queue/queue-model.ts';
import { useChatQueue } from './queue/use-chat-queue.ts';
import { activeRun } from './turns.ts';
import { useStop } from './use-stop.ts';
import { FileSheetProvider } from './project/file-sheet/FileSheet.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { ChatTeammate } from '../teammates/ChatTeammate.tsx';

const NO_REPOS: string[] = [];
const NO_TASKS: TaskOverview[] = [];
const NO_COMMANDS: AgentCommand[] = [];
const NO_RUNS: Run[] = [];

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

  const savedIds = useMemo(
    () => new Set(detail.data?.messages.map((message) => message.id)),
    [detail.data?.messages],
  );
  const sends = useChatSend(conversationId, savedIds, refresh);
  const attachments = useAttachments();
  const latestReplyId =
    detail.data?.messages.findLast((message) => message.role === 'assistant')?.id ?? null;
  const quotes = useQuotes(conversationId, latestReplyId);
  const drop = useFileDrop(attachments.add);
  const stop = useStop(conversationId, detail.data, refresh);
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
  const queue = useChatQueue(conversationId, detail.data?.queue);
  const title = detail.data?.conversation.title ?? '';
  const repos = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_REPOS);
  const settings = detail.data?.settings ?? null;
  const autonomyLevel =
    repos.length > 0 && settings ? (settings.level ?? DEFAULT_INVOLVEMENT_LEVEL) : null;
  const hasBrowser = browserAvailable();
  const mainRef = useRef<HTMLElement>(null);
  const roomy = useRoomy(mainRef);
  const wideLayout = setup.data?.profile.wideWindow ?? DEFAULT_WIDE_WINDOW;
  const panel = useTaskPanel(
    detail.data?.tasks ?? NO_TASKS,
    autonomyLevel !== null,
    panelOpensByDefault(roomy, wideLayout),
    hasBrowser,
  );
  const [railCollapsed, setRailCollapsed] = useRailCollapsed();
  const rail = railState({
    roomy,
    panelOpen: panel.open,
    layout: wideLayout,
    collapsed: railCollapsed,
    turns: detail.data?.runs.length ?? 0,
  });
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
  const diff = useDiffDrawer();
  const openDiff = diff.open;
  const taskId = task?.id ?? null;
  const viewChanges = useMemo(
    () =>
      taskId ? (target?: string, file?: ChangeEntry) => openDiff(target ?? taskId, file) : null,
    [taskId, openDiff],
  );
  const toggleDiff = () => {
    if (diff.request) diff.close();
    else if (task) diff.open(task.id);
  };
  const openPanelTab = useStableCallback((tab: WorkTab) => {
    setPanelTab(tab);
    panel.setOpen(true);
  });
  const openAutonomyPanel = useStableCallback(openAutonomy);
  const reviewChanges = useStableCallback(toggleDiff);
  const collapseRail = useStableCallback(setRailCollapsed);
  const workspace = useChatWorkspace(conversationId, Boolean(detail.data?.conversation.branch));
  const chatBranch = workspace.data?.current ?? null;
  const canAudit = (detail.data?.runs.length ?? 0) > 0;
  const openAudit = canAudit ? () => setAuditOpen(true) : undefined;
  const tickets = useChatTickets(conversationId, (detail.data?.messages.length ?? 0) > 0);
  const [status] = useState(createStatusStore);
  const browsing = panel.open && panel.view === 'browser';
  const toggleBrowser = useStableCallback(() => {
    if (browsing) panel.setOpen(false);
    else panel.setView('browser');
  });
  const addFiles = attachments.add;
  useEffect(
    () =>
      onBrowserPick((pick) => {
        if (pick.chatId === conversationId) addFiles(pickFiles(pick));
      }),
    [conversationId, addFiles],
  );
  const firstRepo = repos[0] ?? null;
  const panelRoots = useMemo(
    () => [
      ...(chatBranch?.worktree ? [chatBranch.path] : []),
      ...repos.map((repo) => repo.rootPath),
    ],
    [chatBranch, repos],
  );

  return (
    <ViewChangesContext value={viewChanges}>
      <StatusContext value={status}>
        <FileSheetProvider>
          <main
            ref={mainRef}
            className={rail === 'hidden' ? 'main' : `main crail-${rail}`}
            {...drop.handlers}
          >
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
                <DiffChip
                  taskId={task?.id ?? null}
                  open={diff.request !== null}
                  onToggle={toggleDiff}
                />
                <WorkPanelToggle panel={panel} waiting={(task?.summary.waiting ?? 0) > 0} />
                {openAudit && (
                  <ChatHeaderMenu onAudit={openAudit} onStartFresh={() => startFresh.mutate()} />
                )}
                <AgentTvButton conversationId={conversationId} agents={tvCrew(detail.data)} />
                {hasBrowser && <BrowserButton open={browsing} onToggle={toggleBrowser} />}
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
                <RailContext
                  value={
                    rail === 'hidden' ? null : (
                      <ChatRail
                        detail={detail.data}
                        repos={repos}
                        taskId={taskId}
                        autonomy={autonomyLevel}
                        running={running !== null}
                        collapsed={rail === 'collapsed'}
                        onCollapse={collapseRail}
                        onTab={openPanelTab}
                        onAutonomy={openAutonomyPanel}
                        onChanges={reviewChanges}
                      />
                    )
                  }
                >
                  <Thread
                    detail={detail.data}
                    repos={repos}
                    sends={sends}
                    onOpenTask={openTask}
                    onOpenChat={openChat}
                    quotes={quotes}
                  />
                </RailContext>
              </PanelOpenContext>
            ) : (
              <div className="thread-wrap" aria-busy={detail.isPending}>
                {detail.isPending && (
                  <LoadingBlob size="lg" className="thread-loading" line="Opening this chat…" />
                )}
              </div>
            )}
            <ComposerStatus
              store={status}
              runs={detail.data?.runs ?? NO_RUNS}
              activeRunId={running?.id ?? null}
              provider={detail.data?.settings.provider ?? ''}
              queued={queue.items.length}
            />
            <QueueStrip
              queue={queue}
              mode={queueMode(running !== null, detail.data?.runs ?? NO_RUNS)}
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
              sending={sends.sending}
              error={stop.error ?? (queue.items.length === 0 ? queue.error : null)}
              notice={sendNowStatus({
                memberMessages: detail.data?.memberMessages,
                runs: detail.data?.runs ?? NO_RUNS,
              })}
              stopping={stop.stopping}
              attachments={attachments}
              quotes={quotes}
              onSend={async (content, files, annotations) => {
                sends.send({ content, attachments: files, annotations });
              }}
              onStop={stop.stop}
              onQueue={queue.add}
              onSendNow={queue.sendFirst}
              busyEnter={setup.data?.profile.busyEnter ?? DEFAULT_BUSY_ENTER}
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
              roots={panelRoots}
              runs={detail.data?.runs ?? []}
              width={panel.width}
              onWidth={panel.setWidth}
              limits={panel.limits}
              view={panel.view}
              onView={panel.setView}
              browser={
                hasBrowser ? (
                  <BrowserPane
                    home={{
                      chatId: conversationId,
                      projectId: firstRepo?.id ?? null,
                      keepSignIns: firstRepo?.browserKeepSignIns ?? true,
                      roots: panelRoots,
                    }}
                    shown={browsing}
                  />
                ) : null
              }
              {...(openAudit ? { onAudit: openAudit } : {})}
            />
          )}
          <DiffDrawerHost state={diff} />
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
