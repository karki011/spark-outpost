import { escapeBelongsToSurface } from '../../ui/foreground-surface.ts';
import './chat-rail.css';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  shownModelName,
  type ConversationDetail,
  type InvolvementLevel,
  type Project,
  type ProviderId,
  type TaskOverview,
} from '@spark-outpost/contracts';
import { capabilitiesQuery } from '../../api/client.ts';
import { desktopBrowser } from '../../desktop/desktop-bridge.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { storedCrew } from '../../crew/conversation-crew.ts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import type { WorkTab } from '../../tasks/TaskDetails.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { contextPercent, latestContext } from '../../usage/format.ts';
import { currentModel } from '../composer/model-options.ts';
import { unlistedPinName } from '../composer/shown-model.ts';
import { permissionState } from '../composer/mode-summary.ts';
import { requestProjectMenu } from '../project/project-menu-request.ts';
import { requestTools } from '../tools/tools-request.ts';
import { useChatWorkspace } from '../project/use-chat-workspace.ts';
import { providerName } from '../provider-name.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { primaryPull } from '../pull-request/pull-request-model.ts';
import { RailCrew } from './RailCrew.tsx';
import { RailPorts } from './RailPorts.tsx';
import { RailToolsLine } from './RailToolsLine.tsx';
import { RailToggleIcon } from './RailIcons.tsx';
import { RailSummary } from './RailSummary.tsx';
import { RailTodo } from './RailTodo.tsx';
import { useLeadSteps } from '../../crew/lead-steps.ts';
import { latestFollowing, railCrew, railRows, type RailAction } from './rail-model.ts';
import { useRailBounds } from './use-rail-layout.ts';
import { usePaneFocused, usePaneId } from '../split/chat-pane.ts';

interface ChatRailProps {
  detail: ConversationDetail;
  repos: readonly Project[];
  taskId: string | null;
  task: TaskOverview | null;
  autonomy: InvolvementLevel | null;
  collapsed: boolean;
  overlay: boolean;
  onCollapse(collapsed: boolean): void;
  onTab(tab: WorkTab): void;
  onAutonomy(): void;
  onChanges(): void;
}

const RAIL_ID = 'chat-rail';

interface RailToggleProps {
  open: boolean;
  focus?: boolean;
  onToggle(): void;
}

function RailToggle({ open, focus = false, onToggle }: RailToggleProps) {
  const label = open ? 'Hide context rail' : 'Show context rail';
  const tip = useTooltip(label);
  const railId = usePaneId(RAIL_ID);
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={open ? 'crail-toggle' : 'crail-toggle crail-show'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={railId}
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <RailToggleIcon open={open} />
      </button>
      {tip.tooltip}
    </>
  );
}

function RailSlot({ children }: { children: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  useRailBounds(slotRef);
  return (
    <div ref={slotRef} className="crail-slot">
      {children}
    </div>
  );
}

export const ChatRail = memo(function ChatRail(props: ChatRailProps) {
  const [backToToggle, setBackToToggle] = useState(false);
  if (props.collapsed) {
    const open = () => {
      setBackToToggle(false);
      props.onCollapse(false);
    };
    return (
      <RailSlot>
        <RailToggle open={false} focus={backToToggle} onToggle={open} />
      </RailSlot>
    );
  }
  const close = (returnFocus: boolean) => {
    setBackToToggle(returnFocus);
    props.onCollapse(true);
  };
  return (
    <RailSlot>
      <OpenRail {...props} onClose={close} />
    </RailSlot>
  );
});

function useFloatingClose(
  rail: RefObject<HTMLElement | null>,
  active: boolean,
  close: (returnFocus: boolean) => void,
) {
  const focused = usePaneFocused();
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    if (!active || !focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escapeBelongsToSurface(event, rail.current)) return;
      event.preventDefault();
      closeRef.current(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (rail.current?.contains(target) || target?.closest('.crail-show')) return;
      if (target?.closest('[role="dialog"], [role="menu"], .tip')) return;
      closeRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [active, focused, rail]);
}

function OpenRail({
  detail,
  repos,
  taskId,
  task,
  autonomy,
  overlay,
  onClose,
  onTab,
  onAutonomy,
  onChanges,
}: ChatRailProps & { onClose(returnFocus: boolean): void }) {
  const conversationId = detail.conversation.id;
  const railRef = useRef<HTMLElement>(null);
  const railId = usePaneId(RAIL_ID);
  const { remote } = useRemoteClient();
  useFloatingClose(railRef, overlay, onClose);
  useLayoutEffect(() => {
    if (overlay) railRef.current?.focus({ preventScroll: true });
  }, [overlay]);
  const { settings } = detail;
  const provider = settings.provider ?? '';
  const capabilities = useQuery(capabilitiesQuery((provider || 'claude') as ProviderId));
  const changes = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null,
  });
  const watches = useQuery(prWatchesQuery(conversationId));
  const workspace = useChatWorkspace(conversationId, Boolean(detail.conversation.branch));

  const list = watches.data?.watches ?? [];
  const watch = primaryPull(list);
  const branch = workspace.data?.current ?? null;
  const reading = latestContext(detail.runs, settings.provider);
  const picked = currentModel(settings, capabilities.data);
  const listed = picked ? shownModelName(picked) : null;
  const unlisted = unlistedPinName(settings, capabilities.data, detail.runs);
  const mode = permissionState(settings, capabilities.data).label;
  const rows = railRows({
    repoNames: repos.map((repo) => repo.name),
    branch: branch ? { name: branch.branch, worktree: branch.worktree } : null,
    provider: providerName(provider),
    model: unlisted ?? listed,
    mode,
    autonomy,
    changes: changes.data ?? null,
    watch,
    pulls: list.length,
    usage: detail.usageTotals,
    contextPercent: reading ? contextPercent(reading.used, reading.size) : null,
    hasTask: taskId !== null,
    hasStoredCrew: storedCrew(detail) !== null,
    following: latestFollowing(detail),
  });
  const openTodo = useCallback(() => onTab('todo'), [onTab]);
  const crew = railCrew(detail, useLeadSteps());

  const act = (action: RailAction) => {
    if (overlay && action.kind !== 'link') onClose(false);
    if (action.kind === 'project') requestProjectMenu(conversationId);
    if (action.kind === 'tab') onTab(action.tab);
    if (action.kind === 'autonomy') onAutonomy();
    if (action.kind === 'changes') onChanges();
    if (action.kind === 'tools') requestTools(conversationId);
  };

  return (
    <section
      ref={railRef}
      className={overlay ? 'crail floating' : 'crail'}
      id={railId}
      aria-label="Chat context"
      tabIndex={overlay ? -1 : undefined}
    >
      <div className="crail-context">
        <div className="crail-head">
          <h3 className="crail-title">Context</h3>
          <RailToggle open onToggle={() => onClose(true)} />
        </div>
        <RailSummary rows={rows} provider={provider} onAction={act} />
        {desktopBrowser() !== null && !remote && <RailPorts chatId={conversationId} />}
      </div>
      {task && <RailTodo task={task} onOpen={openTodo} />}
      {crew.length > 0 && <RailCrew conversationId={conversationId} agents={crew} mode={mode} />}
      <RailToolsLine conversationId={conversationId} onOpen={() => act({ kind: 'tools' })} />
    </section>
  );
}
