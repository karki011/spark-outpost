import './chat-surface.css';
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
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { DiffChip } from '../diff/DiffChip.tsx';
import { DiffDrawerHost, useDiffDrawer } from '../diff/DiffDrawerHost.tsx';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { belongsTo, conversationCrew, storedCrew, tvCrew } from '../crew/conversation-crew.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { BrowserPane } from '../browser/BrowserPane.tsx';
import { ChatLinks } from '../browser/ChatLinks.tsx';
import { usePreviewDockTab } from '../browser/use-chat-preview.ts';
import { useBrowserPane } from '../browser/pane-open.ts';
import { useBrowserInput } from '../browser/use-browser-input.ts';
import { TerminalDock } from '../terminal/dock/TerminalDock.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { PanelOpenContext } from '../tasks/panel-open.ts';
import { useTaskPanel } from '../tasks/work-panel-state.ts';
import { ViewChangesContext } from '../tasks/view-changes.ts';
import { OpenPlanContext } from './plans/PlanSavedLine.tsx';
import type { WorkTab } from '../tasks/TaskDetails.tsx';
import { WorkPanel } from '../tasks/WorkPanel.tsx';
import { WorkPanelToggle } from '../tasks/WorkPanelToggle.tsx';
import { DropOverlay } from './attachments/DropOverlay.tsx';
import { useAttachments } from './attachments/use-attachments.ts';
import { useFileDrop } from './attachments/use-file-drop.ts';
import { ChatHeadTools } from './ChatHeadTools.tsx';
import { Composer } from './Composer.tsx';
import { ComposerStatus } from './status/ComposerStatus.tsx';
import { StatusContext } from './status/status-context.ts';
import { createStatusStore } from './status/status-store.ts';
import { providerName } from './provider-name.ts';
import { repoSummary } from './project/repo-list.ts';
import { useLinkedProjects } from './project/use-chat-repos.ts';
import { PrCard } from './pull-request/PrCard.tsx';
import { usePullRequestRefresh } from './pull-request/use-pull-request-refresh.ts';
import { ChatTicketBar } from './tickets/ChatTicketBar.tsx';
import { ChatTicketChips } from './tickets/ChatTicketChips.tsx';
import { useChatTickets } from './tickets/use-chat-tickets.ts';
import { useChatWorkspace } from './project/use-chat-workspace.ts';
import { ChatRail } from './rail/ChatRail.tsx';
import { showsTaskCard } from '../tasks/task-card-shown.ts';
import { RailContext, RailTaskContext } from './rail/rail-context.ts';
import { useRailCollapsed, useRoomy } from './rail/use-rail-layout.ts';
import { panelOpensByDefault, railState } from './rail/wide-layout.ts';
import { createFollowRequests, FollowContext } from './follow-requests.ts';
import { Thread } from './Thread.tsx';
import { useQuotes } from './quotes/use-quotes.ts';
import { useChatSend } from './send/use-chat-send.ts';
import { QueueStrip } from './queue/QueueStrip.tsx';
import { enterWhileBusy, sendNowStatus } from './queue/send-choice.ts';
import { queueMode } from './queue/queue-model.ts';
import { useSparkPause } from '../app/pause/use-spark-pause.ts';
import { useChatQueue } from './queue/use-chat-queue.ts';
import { activeRun, latestReplyId } from './turns.ts';
import { useStop } from './use-stop.ts';
import { FileSheetProvider } from './project/file-sheet/FileSheet.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { sessionView } from './session-view.ts';
import { NativeTerminalWorkspace } from '../terminal/NativeTerminalWorkspace.tsx';
import { TerminalComposer } from '../terminal/TerminalComposer.tsx';
import { SessionTypePicker, type SessionChoice } from '../terminal/SessionTypePicker.tsx';
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
  const [sessionChoice, setSessionChoice] = useState<SessionChoice>({
    sessionType: 'chat',
    terminalProvider: 'claude',
  });
  const [terminalLaunching, setTerminalLaunching] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  });

  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const sparkPaused = useSparkPause().paused;
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
  const latestReply = useMemo(
    () => (detail.data ? latestReplyId(detail.data) : null),
    [detail.data],
  );
  const quotes = useQuotes(conversationId, latestReply);
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
  const waitingOn = running ? (detail.data?.conversation.latestRun?.waitingOn ?? 0) : 0;
  usePreviewDockTab(conversationId);
  const queue = useChatQueue(conversationId, detail.data?.queue);
  const title = detail.data?.conversation.title ?? '';
  const repos = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_REPOS);
  const settings = detail.data?.settings ?? null;
  const autonomyLevel =
    repos.length > 0 && settings && detail.data?.conversation.sessionType !== 'terminal'
      ? (settings.level ?? DEFAULT_INVOLVEMENT_LEVEL)
      : null;
  const { remote } = useRemoteClient();
  const browserPane = useBrowserPane(conversationId);
  const hasBrowser = browserPane !== null;
  const mainRef = useRef<HTMLElement>(null);
  const roomy = useRoomy(mainRef);
  const wideLayout = setup.data?.profile.wideWindow ?? DEFAULT_WIDE_WINDOW;
  const panel = useTaskPanel(
    detail.data?.tasks ?? NO_TASKS,
    autonomyLevel !== null || detail.data?.conversation.sessionType === 'terminal',
    panelOpensByDefault(roomy, wideLayout),
    browserPane,
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
  const openTask = useStableCallback(panel.openTask);
  const openChat = useStableCallback(onOpenChat);
  const task = panel.task;
  const crewRun = storedCrew(detail.data);
  const taskCrew = task && crewRun && belongsTo(task, crewRun) ? crewRun : null;
  const [auditOpen, setAuditOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WorkTab>('tasks');
  const [autonomyRequest, setAutonomyRequest] = useState(0);
  const openAutonomy = () => {
    panel.setView('work');
    setAutonomyRequest((request) => request + 1);
  };
  const diff = useDiffDrawer();
  const openDiff = diff.open;
  const taskId = task?.id ?? null;
  const railTask = task && showsTaskCard(task) ? task : null;
  const viewChanges = useMemo(
    () =>
      taskId ? (target?: string, file?: ChangeEntry) => openDiff(target ?? taskId, file) : null,
    [taskId, openDiff],
  );
  const toggleDiff = () => {
    if (diff.request) diff.close();
    else diff.open(taskId);
  };
  const openPanelTab = useStableCallback((tab: WorkTab) => {
    setPanelTab(tab);
    panel.setView('work');
  });
  const openPlan = useStableCallback(() => openPanelTab('plan'));
  const openLinks = useStableCallback(() => openPanelTab('links'));
  usePullRequestRefresh(conversationId, running !== null);
  const openAutonomyPanel = useStableCallback(openAutonomy);
  const reviewChanges = useStableCallback(toggleDiff);
  const collapseRail = useStableCallback(setRailCollapsed);
  const workspace = useChatWorkspace(conversationId, Boolean(detail.data?.conversation.branch));
  const chatBranch = workspace.data?.current ?? null;
  const canAudit = (detail.data?.runs.length ?? 0) > 0;
  const openAudit = canAudit ? () => setAuditOpen(true) : undefined;
  const tickets = useChatTickets(conversationId, (detail.data?.messages.length ?? 0) > 0);
  const [status] = useState(createStatusStore);
  const [followRequests] = useState(createFollowRequests);
  const browsing = panel.open && panel.view === 'browser';
  const toggleBrowser = useStableCallback(() => {
    if (browsing) panel.closeBrowser();
    else panel.setView('browser');
  });
  const firstRepo = repos[0] ?? null;
  const view = sessionView(detail.data, terminalLaunching);
  const terminalSession = view === 'terminal';
  useBrowserInput(conversationId, terminalSession, attachments.addPick, quotes.requestFocus);
  const newSession = view === 'draft';
  const chooseSession = (choice: SessionChoice) => {
    setSessionChoice(choice);
    if (choice.sessionType === 'chat' && detail.data?.conversation.sessionType === 'terminal')
      void api.resetSessionDraft(conversationId).then(refresh, () => null);
  };
  const terminalDraft = newSession && sessionChoice.sessionType === 'terminal' && !remote;
  const sessionPicker = newSession ? (
    <SessionTypePicker
      value={sessionChoice}
      onChange={chooseSession}
      disabled={terminalLaunching}
    />
  ) : null;
  const panelRoots = useMemo(
    () => [
      ...(chatBranch?.worktree ? [chatBranch.path] : []),
      ...repos.map((repo) => repo.rootPath),
    ],
    [chatBranch, repos],
  );
  const browserHome = {
    chatId: conversationId,
    projectId: firstRepo?.id ?? null,
    keepSignIns: firstRepo?.browserKeepSignIns ?? true,
    roots: panelRoots,
    sendsTo: terminalSession ? ('terminal' as const) : ('chat' as const),
  };

  return (
    <ViewChangesContext value={viewChanges}>
      <OpenPlanContext value={task ? openPlan : null}>
        <StatusContext value={status}>
          <FileSheetProvider>
            <main
              ref={mainRef}
              className={rail === 'hidden' ? 'main' : `main crail-${rail}`}
              data-chat-links=""
              {...(terminalSession || terminalDraft ? {} : drop.handlers)}
            >
              <header className="head chat-head">
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
                    detail.data?.conversation.titleSource === 'auto'
                      ? 'Renamed by Spark'
                      : undefined
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
                  <ChatHeadTools
                    conversationId={conversationId}
                    agents={tvCrew(detail.data)}
                    browser={hasBrowser ? { open: browsing, onToggle: toggleBrowser } : null}
                    onAudit={openAudit}
                    onStartFresh={() => startFresh.mutate()}
                    canStartFresh={!terminalSession}
                    terminalDock={!terminalSession && !terminalDraft}
                  />
                </div>
              </header>
              <ChatTicketBar chat={tickets} />
              {detail.isError && !isConnectionLoss(detail.error) && (
                <p className="error-line" role="alert">
                  {detail.error.message}
                </p>
              )}
              {terminalSession && detail.data ? (
                <NativeTerminalWorkspace
                  chat={detail.data.conversation}
                  detail={detail.data}
                  panel={panel}
                  browserHome={hasBrowser ? browserHome : null}
                />
              ) : terminalDraft ? (
                <TerminalComposer
                  conversationId={conversationId}
                  choice={sessionChoice}
                  onChoice={chooseSession}
                  sessionPicker={sessionPicker}
                  settings={settings}
                  connected={connected.some(
                    (provider) => provider.id === sessionChoice.terminalProvider,
                  )}
                  projectIds={detail.data?.conversation.projectIds ?? []}
                  onStarting={() => setTerminalLaunching(true)}
                  onLaunched={() => setTerminalLaunching(false)}
                  onFailed={(created) => {
                    setTerminalLaunching(false);
                    if (created) void refresh();
                  }}
                />
              ) : detail.data ? (
                <PanelOpenContext value={panel.open}>
                  <RailContext
                    value={
                      rail === 'hidden' ? null : (
                        <ChatRail
                          detail={detail.data}
                          repos={repos}
                          taskId={taskId}
                          task={railTask}
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
                    <RailTaskContext value={rail === 'open' ? (railTask?.id ?? null) : null}>
                      <FollowContext value={followRequests}>
                        <Thread
                          detail={detail.data}
                          repos={repos}
                          sends={sends}
                          taskId={taskId}
                          onOpenTask={openTask}
                          onOpenChat={openChat}
                          quotes={quotes}
                        />
                      </FollowContext>
                    </RailTaskContext>
                  </RailContext>
                </PanelOpenContext>
              ) : (
                <div className="thread-wrap" aria-busy={detail.isPending}>
                  {detail.isPending && (
                    <LoadingBlob size="lg" className="thread-loading" line="Opening this chat…" />
                  )}
                </div>
              )}
              {!terminalSession && !terminalDraft && (
                <>
                  <ComposerStatus
                    store={status}
                    runs={detail.data?.runs ?? NO_RUNS}
                    activeRunId={running?.id ?? null}
                    provider={detail.data?.settings.provider ?? ''}
                    queued={queue.items.length}
                  />
                  <QueueStrip
                    queue={queue}
                    mode={queueMode(running !== null, detail.data?.runs ?? NO_RUNS, sparkPaused)}
                  />
                  <Composer
                    conversationId={conversationId}
                    repos={repos}
                    settings={settings}
                    providers={connected}
                    runs={detail.data?.runs ?? []}
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
                    onQueue={(content) => {
                      followRequests.request();
                      return queue.add(content);
                    }}
                    onSendNow={(content) => {
                      followRequests.request();
                      return queue.sendFirst(content);
                    }}
                    busyEnter={enterWhileBusy(
                      setup.data?.profile.busyEnter ?? DEFAULT_BUSY_ENTER,
                      waitingOn,
                    )}
                    waitingOn={waitingOn}
                    above={
                      <PrCard
                        conversationId={conversationId}
                        onOpenLinks={task ? openLinks : null}
                      />
                    }
                    {...(openAudit ? { onAudit: openAudit } : {})}
                    onStartFresh={() => startFresh.mutate()}
                    autonomy={autonomyLevel ? { level: autonomyLevel, onOpen: openAutonomy } : null}
                    agentCommands={commands.data?.commands ?? NO_COMMANDS}
                    agentName={providerName(
                      commands.data?.provider ?? detail.data?.settings.provider ?? '',
                    )}
                    contextLead={sessionPicker}
                  />
                </>
              )}
              {!remote && !terminalSession && !terminalDraft && (
                <TerminalDock chatId={conversationId} />
              )}
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
                terminal={terminalSession}
                width={panel.width}
                onWidth={panel.setWidth}
                limits={panel.limits}
                view={panel.view}
                onView={panel.setView}
                browser={
                  hasBrowser
                    ? ({ views, close }) => (
                        <BrowserPane
                          home={browserHome}
                          shown={browsing}
                          lead={views}
                          trail={close}
                        />
                      )
                    : null
                }
                {...(openAudit ? { onAudit: openAudit } : {})}
              />
            )}
            {hasBrowser && <ChatLinks home={browserHome} />}
            <DiffDrawerHost state={diff} taskId={taskId} />
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
      </OpenPlanContext>
    </ViewChangesContext>
  );
}
