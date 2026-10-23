import type {
  ContentBlock,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
} from '@agentclientprotocol/sdk';
import type { ConfigValues, PlanEntry } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { currentValue } from './session-config.ts';
import { currentValues } from './capabilities.ts';
import { findPullRequests } from '../../tasks/pr-links.ts';
import { agentCommands } from './slash-commands.ts';
import { objectFields } from './object-fields.ts';
import { exitPlanText, planFileText } from '../../plans/plan-mode.ts';
import { shortWindowNote } from './long-context.ts';
import { planOutputs, usageOutputs } from './plan-limits.ts';
import { createFocusTracker } from './file-focus.ts';
import { messagePhase } from './message-phase.ts';
import { artifactLinks } from './artifact-links.ts';
import {
  awaitsAddress,
  describeTool,
  opensPullRequest,
  toolNameOf,
  toolTarget,
} from './tool-titles.ts';

export const THINKING_STEP = 'Thinking';
export const FAILED_PREFIX = 'Failed: ';

export interface AgentFailure {
  category: string;
  title: string;
}

export interface UpdateMapper {
  map(update: SessionUpdate): ProviderOutput[];
  failure(): AgentFailure | null;
  stalled(): AgentFailure | null;
  stopped(meta: unknown): void;
  repliedWithText(): boolean;
  didWork(): boolean;
  trackSettings(settings: TrackedSettings, policy: ModePolicy): void;
  unsafeModeChange(): string | null;
  currentMode(): string | null;
  shownPlan(): string | null;
  note(name: string): ProviderOutput[];
  clientAction(name: string): ProviderOutput[];
  finish(cancelled?: boolean): ProviderOutput[];
}

export interface TrackedSettings {
  model: string | null;
  effort: string | null;
  mode: string | null;
  values: ConfigValues;
}

export interface ModePolicy {
  allowed(mode: string): boolean;
  name(mode: string): string;
}

type SessionSettingsOutput = Extract<ProviderOutput, { kind: 'session_settings' }>;

function settingsFrom(
  options: readonly SessionConfigOption[],
  previous: TrackedSettings,
): TrackedSettings {
  return {
    model: currentValue(options, 'model') ?? previous.model,
    effort: currentValue(options, 'thought_level') ?? previous.effort,
    mode: currentValue(options, 'mode') ?? previous.mode,
    values: { ...previous.values, ...currentValues(options) },
  };
}

const sameValues = (a: ConfigValues, b: ConfigValues) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, value]) => b[key] === value);

interface ReportedFailure extends AgentFailure {
  severity: string;
}

export function sessionFailure(meta: unknown): ReportedFailure | null {
  const failure = objectFields(
    objectFields(objectFields(objectFields(meta).jetbrains).air).sessionFailure,
  );
  const { severity, title, category } = failure;
  if (typeof severity !== 'string' || typeof title !== 'string') return null;
  return { severity, title, category: typeof category === 'string' ? category : 'provider_error' };
}

const PROVIDER_ISSUES = new Set([
  'limit',
  'access',
  'connection',
  'rate_limited',
  'auth_required',
  'transport_lost',
]);

interface OpenTool {
  name: string;
  kind: string | null;
  toolName: string | null;
  target: string | null;
  opensPr: boolean;
  linked: boolean;
  shown: boolean;
}

function stepOf(kind: 'step_started' | 'step_finished', open: OpenTool): ProviderOutput {
  return {
    kind,
    name: open.name,
    tool: true,
    ...(open.kind ? { toolKind: open.kind } : {}),
    ...(open.toolName ? { toolName: open.toolName } : {}),
    ...(open.target ? { target: open.target } : {}),
  };
}

type ToolCallUpdate = Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>;

const NOTICE_LABELS: Record<string, string> = { error: 'Error', warning: 'Warning' };

const noticeLabel = (severity: string) => NOTICE_LABELS[severity] ?? 'Note';

const WEB_LINK = /^https?:$/;

function messageText(content: ContentBlock): string {
  if (content.type === 'text') return content.text;
  if (content.type !== 'resource_link') return '';
  let url: URL;
  try {
    url = new URL(content.uri);
  } catch {
    return '';
  }
  if (!WEB_LINK.test(url.protocol)) return '';
  const label = content.name.replace(/[[\]]/g, '').trim() || url.hostname;
  return `[${label}](${url.href.replace(/[()]/g, (paren) => (paren === '(' ? '%28' : '%29'))})`;
}

const noteSteps = (name: string, tool = false): ProviderOutput[] => [
  tool ? { kind: 'step_started', name, tool } : { kind: 'step_started', name },
  { kind: 'step_finished', name },
];

type LinkSource = Extract<ProviderOutput, { kind: 'link' }>['source'];

const PLAN_ENTRY_MAX = 2000;
const PLAN_ENTRIES_MAX = 200;

export function planEntries(entries: readonly PlanEntry[]): PlanEntry[] {
  return entries.slice(0, PLAN_ENTRIES_MAX).flatMap((entry) => {
    const content = entry.content.trim().slice(0, PLAN_ENTRY_MAX);
    return content ? [{ content, priority: entry.priority, status: entry.status }] : [];
  });
}

function toolTexts(
  content: readonly ToolCallContent[] | null | undefined,
  rawOutput: unknown,
): [string, LinkSource][] {
  const texts: [string, LinkSource][] = [];
  for (const item of content ?? []) {
    if (item.type !== 'content') continue;
    if (item.content.type === 'text') texts.push([item.content.text, 'tool_output']);
    if (item.content.type === 'resource_link') texts.push([item.content.uri, 'resource_link']);
  }
  if (rawOutput !== undefined && rawOutput !== null) {
    texts.push([
      typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
      'tool_output',
    ]);
  }
  return texts;
}

export function createUpdateMapper(agentName = 'The agent', checksWindow = false): UpdateMapper {
  const openTools = new Map<string, OpenTool>();
  const focus = createFocusTracker();
  const seenLinks = new Set<string>();
  let thinking = false;
  let lastMessageId: string | null = null;
  let wroteText = false;
  let worked = false;
  let failure: AgentFailure | null = null;
  let warned: AgentFailure | null = null;
  let tracked: TrackedSettings | null = null;
  let policy: ModePolicy | null = null;
  let unsafeMode: string | null = null;
  let plan: string | null = null;
  let windowNoted = false;

  const rememberPlan = (kind: string | null | undefined, rawInput: unknown, content: unknown) => {
    const items = Array.isArray(content) ? (content as ToolCallContent[]) : null;
    plan = exitPlanText(kind, rawInput, items) ?? planFileText(rawInput) ?? plan;
  };

  const stopThinking = (): ProviderOutput[] => {
    if (!thinking) return [];
    thinking = false;
    return [{ kind: 'step_finished', name: THINKING_STEP }];
  };

  const finishTool = (id: string, failed = false): ProviderOutput[] => {
    const open = openTools.get(id);
    if (open === undefined) return [];
    openTools.delete(id);
    focus.done(id);
    const outputs = [
      ...(open.shown ? [] : [stepOf('step_started', open)]),
      stepOf('step_finished', open),
    ];
    if (failed) outputs.push(...noteSteps(FAILED_PREFIX + open.name));
    return outputs;
  };

  const reveal = (update: ToolCallUpdate): ProviderOutput[] => {
    const open = openTools.get(update.toolCallId);
    if (!open || open.shown || !update.title) return [];
    if (awaitsAddress(update.title, update.kind ?? open.kind)) return [];
    open.name = describeTool(update.title, update.kind ?? open.kind);
    open.shown = true;
    return [stepOf('step_started', open)];
  };

  const retarget = (update: ToolCallUpdate) => {
    const open = openTools.get(update.toolCallId);
    if (!open) return;
    open.opensPr ||= opensPullRequest(update.title, update.rawInput);
    open.toolName = toolNameOf(update) ?? open.toolName;
    const title = update.title ? describeTool(update.title, update.kind ?? open.kind) : null;
    open.target =
      toolTarget(update.locations, update.rawInput) ??
      (title && title !== open.name ? title : open.target);
  };

  const note = (name: string): ProviderOutput[] => [...stopThinking(), ...noteSteps(name)];

  const settingsOutput = (settings: TrackedSettings): SessionSettingsOutput => ({
    kind: 'session_settings',
    model: settings.model,
    effort: settings.effort,
    mode: settings.mode,
    options: settings.values,
  });

  const changeSettings = (next: TrackedSettings): ProviderOutput[] => {
    if (!tracked || !policy) return [];
    const previous = tracked;
    const modeChanged = next.mode !== null && next.mode !== previous.mode;
    if (modeChanged && next.mode === unsafeMode) return [];
    if (modeChanged && !policy.allowed(next.mode!)) {
      unsafeMode = next.mode;
      return note(`Warning: ${agentName} switched to ${policy.name(next.mode!)} mode`);
    }
    const changed =
      modeChanged ||
      next.model !== previous.model ||
      next.effort !== previous.effort ||
      !sameValues(next.values, previous.values);
    if (!changed) return [];
    tracked = next;
    const shown = modeChanged
      ? note(`${agentName} switched to ${policy.name(next.mode!)} mode`)
      : [];
    return [...shown, settingsOutput(next)];
  };

  const links = (texts: readonly [string, LinkSource][]): ProviderOutput[] =>
    texts.flatMap(([text, source]) =>
      findPullRequests(text).flatMap(({ url, title }): ProviderOutput[] => {
        if (seenLinks.has(url)) return [];
        seenLinks.add(url);
        return [{ kind: 'link', url, title, source }];
      }),
    );

  const openedLink = (id: string, texts: readonly [string, LinkSource][]): ProviderOutput[] => {
    const open = openTools.get(id);
    if (!open?.opensPr || open.linked) return [];
    const first = links(texts)[0];
    if (!first) return [];
    open.linked = true;
    return [first];
  };

  const progressed = (update: SessionUpdate) => {
    if (update.sessionUpdate === 'tool_call') warned = null;
    if (update.sessionUpdate === 'agent_message_chunk' && messageText(update.content) !== '') {
      warned = null;
    }
  };

  return {
    map(update) {
      progressed(update);
      switch (update.sessionUpdate) {
        case 'agent_thought_chunk': {
          const text = update.content.type === 'text' ? update.content.text : '';
          const thought: ProviderOutput[] = text ? [{ kind: 'thought_delta', delta: text }] : [];
          if (thinking) return thought;
          thinking = true;
          return [{ kind: 'step_started', name: THINKING_STEP }, ...thought];
        }
        case 'agent_message_chunk': {
          const linked = [
            ...artifactLinks(update.content),
            ...(update.content.type === 'resource_link'
              ? links([[update.content.uri, 'resource_link']])
              : []),
          ];
          const chunk = messageText(update.content);
          if (chunk === '') return [...stopThinking(), ...linked];
          const messageId = update.messageId ?? null;
          const separator =
            wroteText && messageId !== null && lastMessageId !== null && messageId !== lastMessageId
              ? '\n\n'
              : '';
          lastMessageId = messageId ?? lastMessageId;
          wroteText = true;
          const next = separator ? { newMessage: true } : {};
          const said = { kind: 'text_delta', delta: separator + chunk, ...next } as const;
          return [...stopThinking(), ...linked, { ...said, ...messagePhase(update._meta) }];
        }
        case 'tool_call': {
          rememberPlan(update.kind, update.rawInput, update.content);
          const outputs = [...stopThinking(), ...finishTool(update.toolCallId)];
          const name = describeTool(update.title, update.kind);
          worked = true;
          const opened: OpenTool = {
            name,
            kind: update.kind ?? null,
            toolName: toolNameOf(update),
            target: toolTarget(update.locations, update.rawInput),
            opensPr: opensPullRequest(update.title, update.rawInput),
            linked: false,
            shown: !awaitsAddress(update.title, update.kind),
          };
          openTools.set(update.toolCallId, opened);
          outputs.push(
            ...focus.see(
              update.toolCallId,
              update.kind,
              update.locations,
              update.rawInput,
              update.content,
            ),
          );
          if (opened.shown) outputs.push(stepOf('step_started', opened));
          outputs.push(
            ...openedLink(update.toolCallId, toolTexts(update.content, update.rawOutput)),
          );
          if (update.status === 'completed' || update.status === 'failed') {
            outputs.push(...finishTool(update.toolCallId, update.status === 'failed'));
          }
          return outputs;
        }
        case 'tool_call_update': {
          rememberPlan(
            update.kind ?? openTools.get(update.toolCallId)?.kind,
            update.rawInput,
            update.content,
          );
          retarget(update);
          const open = openTools.get(update.toolCallId);
          const linked = [
            ...reveal(update),
            ...(open
              ? focus.see(
                  update.toolCallId,
                  update.kind ?? open.kind,
                  update.locations,
                  update.rawInput,
                  update.content,
                )
              : []),
            ...openedLink(update.toolCallId, toolTexts(update.content, update.rawOutput)),
            ...artifactLinks(update.content),
          ];
          if (update.status === 'completed' || update.status === 'failed') {
            return [...linked, ...finishTool(update.toolCallId, update.status === 'failed')];
          }
          return linked;
        }
        case 'plan':
          return [...stopThinking(), { kind: 'plan', entries: planEntries(update.entries) }];
        case 'current_mode_update':
          return tracked ? changeSettings({ ...tracked, mode: update.currentModeId }) : [];
        case 'config_option_update':
          return tracked ? changeSettings(settingsFrom(update.configOptions, tracked)) : [];
        case 'session_info_update': {
          const reported = sessionFailure(update._meta);
          if (!reported) return planOutputs(update._meta);
          if (reported.severity === 'error') {
            failure = { category: reported.category, title: reported.title };
            return [];
          }
          if (PROVIDER_ISSUES.has(reported.category)) {
            warned = { category: reported.category, title: reported.title };
          }
          return note(`Warning: ${reported.title}`);
        }
        case 'notice':
          return note(`${noticeLabel(update.severity)}: ${update.title}`);
        case 'available_commands_update':
          return [{ kind: 'commands', commands: agentCommands(update.availableCommands) }];
        case 'usage_update': {
          const outputs = usageOutputs(update);
          const short =
            checksWindow && !windowNoted && update.cost
              ? shortWindowNote(update._meta, update.size)
              : null;
          if (!short) return outputs;
          windowNoted = true;
          return [...outputs, ...note(short)];
        }
        default:
          return [];
      }
    },
    failure: () => failure,
    stalled: () => warned,
    stopped(meta) {
      const reported = sessionFailure(meta);
      if (reported?.severity !== 'error') return;
      failure = { category: reported.category, title: reported.title };
    },
    repliedWithText: () => wroteText,
    didWork: () => worked,
    trackSettings(settings, modes) {
      tracked = settings;
      policy = modes;
    },
    unsafeModeChange: () => unsafeMode,
    currentMode: () => tracked?.mode ?? null,
    shownPlan: () => plan,
    note,
    clientAction(name) {
      worked = true;
      return [...stopThinking(), ...noteSteps(name, true)];
    },
    finish(cancelled = false) {
      const outputs = stopThinking();
      for (const id of [...openTools.keys()]) {
        if (cancelled) openTools.delete(id);
        else outputs.push(...finishTool(id));
      }
      return outputs;
    },
  };
}
