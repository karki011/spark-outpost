import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import type { PlanEntry } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { PLAN_MODE } from '../../plans/plan-mode.ts';
import { findPullRequests } from '../../tasks/pr-links.ts';
import { agentCommands } from './slash-commands.ts';

export const THINKING_STEP = 'Thinking';
export const FAILED_PREFIX = 'Failed: ';

export interface AgentFailure {
  category: string;
  title: string;
}

export interface UpdateMapper {
  map(update: SessionUpdate): ProviderOutput[];
  failure(): AgentFailure | null;
  repliedWithText(): boolean;
  didWork(): boolean;
  lockMode(modeId: string | null): void;
  unsafeModeChange(): string | null;
  note(name: string): ProviderOutput[];
  clientAction(name: string): ProviderOutput[];
  finish(cancelled?: boolean): ProviderOutput[];
}

interface ReportedFailure extends AgentFailure {
  severity: string;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export function sessionFailure(meta: unknown): ReportedFailure | null {
  const failure = record(record(record(record(meta).jetbrains).air).sessionFailure);
  const { severity, title, category } = failure;
  if (typeof severity !== 'string' || typeof title !== 'string') return null;
  return { severity, title, category: typeof category === 'string' ? category : 'provider_error' };
}

const ABSOLUTE_PATH = /(^|[\s(])(\/[^\s`'")]+)/g;

export function describeTool(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Using a tool';
  return trimmed
    .split('`')
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(ABSOLUTE_PATH, (_match, lead: string, path: string) => {
            const name = path.split('/').filter(Boolean).at(-1) ?? path;
            return `${lead}\`${name}\``;
          }),
    )
    .join('`');
}

const TARGET_CHARS = 400;

interface OpenTool {
  name: string;
  kind: string | null;
  target: string | null;
}

type ToolCallUpdate = Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>;

function isEmptyInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}

export function toolTarget(
  locations: readonly { path: string; line?: number | null }[] | null | undefined,
  rawInput: unknown,
): string | null {
  const paths = (locations ?? []).map((location) => `${location.path}:${location.line ?? ''}`);
  let input = '';
  if (rawInput !== undefined && rawInput !== null && !isEmptyInput(rawInput)) {
    try {
      input = JSON.stringify(rawInput) ?? '';
    } catch {
      input = '';
    }
  }
  const target = [paths.join(','), input].filter(Boolean).join(' ');
  return target ? target.slice(0, TARGET_CHARS) : null;
}

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

export function createUpdateMapper(agentName = 'The agent'): UpdateMapper {
  const openTools = new Map<string, OpenTool>();
  const seenLinks = new Set<string>();
  let thinking = false;
  let lastMessageId: string | null = null;
  let wroteText = false;
  let worked = false;
  let failure: AgentFailure | null = null;
  let lockedMode: string | null = null;
  let unsafeMode: string | null = null;

  const stopThinking = (): ProviderOutput[] => {
    if (!thinking) return [];
    thinking = false;
    return [{ kind: 'step_finished', name: THINKING_STEP }];
  };

  const finishTool = (id: string, failed = false): ProviderOutput[] => {
    const open = openTools.get(id);
    if (open === undefined) return [];
    openTools.delete(id);
    const outputs: ProviderOutput[] = [
      {
        kind: 'step_finished',
        name: open.name,
        tool: true,
        ...(open.kind ? { toolKind: open.kind } : {}),
        ...(open.target ? { target: open.target } : {}),
      },
    ];
    if (failed) outputs.push(...noteSteps(FAILED_PREFIX + open.name));
    return outputs;
  };

  const retarget = (update: ToolCallUpdate) => {
    const open = openTools.get(update.toolCallId);
    if (!open) return;
    const title = update.title ? describeTool(update.title) : null;
    open.target =
      toolTarget(update.locations, update.rawInput) ??
      (title && title !== open.name ? title : open.target);
  };

  const note = (name: string): ProviderOutput[] => [...stopThinking(), ...noteSteps(name)];

  const changeMode = (modeId: string): ProviderOutput[] => {
    if (lockedMode === null || modeId === lockedMode || modeId === unsafeMode) return [];
    if (modeId === PLAN_MODE) return [];
    unsafeMode = modeId;
    return note(`Warning: ${agentName} switched to ${modeId} mode`);
  };

  const links = (texts: readonly [string, LinkSource][]): ProviderOutput[] =>
    texts.flatMap(([text, source]) =>
      findPullRequests(text).flatMap(({ url, title }): ProviderOutput[] => {
        if (seenLinks.has(url)) return [];
        seenLinks.add(url);
        return [{ kind: 'link', url, title, source }];
      }),
    );

  return {
    map(update) {
      switch (update.sessionUpdate) {
        case 'agent_thought_chunk': {
          if (thinking) return [];
          thinking = true;
          return [{ kind: 'step_started', name: THINKING_STEP }];
        }
        case 'agent_message_chunk': {
          const linked =
            update.content.type === 'resource_link'
              ? links([[update.content.uri, 'resource_link']])
              : [];
          const chunk = messageText(update.content);
          if (chunk === '') return [...stopThinking(), ...linked];
          const messageId = update.messageId ?? null;
          const separator =
            wroteText && messageId !== null && lastMessageId !== null && messageId !== lastMessageId
              ? '\n\n'
              : '';
          lastMessageId = messageId ?? lastMessageId;
          wroteText = true;
          return [...stopThinking(), ...linked, { kind: 'text_delta', delta: separator + chunk }];
        }
        case 'tool_call': {
          const outputs = [...stopThinking(), ...finishTool(update.toolCallId)];
          const name = describeTool(update.title);
          worked = true;
          const target = toolTarget(update.locations, update.rawInput);
          openTools.set(update.toolCallId, { name, kind: update.kind ?? null, target });
          outputs.push({
            kind: 'step_started',
            name,
            tool: true,
            ...(update.kind ? { toolKind: update.kind } : {}),
            ...(target ? { target } : {}),
          });
          outputs.push(...links(toolTexts(update.content, update.rawOutput)));
          if (update.status === 'completed' || update.status === 'failed') {
            outputs.push(...finishTool(update.toolCallId, update.status === 'failed'));
          }
          return outputs;
        }
        case 'tool_call_update': {
          retarget(update);
          const linked = links(toolTexts(update.content, update.rawOutput));
          if (update.status === 'completed' || update.status === 'failed') {
            return [...linked, ...finishTool(update.toolCallId, update.status === 'failed')];
          }
          return linked;
        }
        case 'plan':
          return [...stopThinking(), { kind: 'plan', entries: planEntries(update.entries) }];
        case 'current_mode_update':
          return changeMode(update.currentModeId);
        case 'config_option_update': {
          const mode = update.configOptions.find((option) => option.category === 'mode');
          return typeof mode?.currentValue === 'string' ? changeMode(mode.currentValue) : [];
        }
        case 'session_info_update': {
          const reported = sessionFailure(update._meta);
          if (!reported) return [];
          if (reported.severity === 'error') {
            failure = { category: reported.category, title: reported.title };
            return [];
          }
          return note(`Warning: ${reported.title}`);
        }
        case 'notice':
          return note(`${noticeLabel(update.severity)}: ${update.title}`);
        case 'available_commands_update':
          return [{ kind: 'commands', commands: agentCommands(update.availableCommands) }];
        case 'usage_update':
          return [
            {
              kind: 'usage',
              contextUsed: update.used,
              contextSize: update.size,
              costUsd: update.cost?.currency === 'USD' ? update.cost.amount : null,
            },
          ];
        default:
          return [];
      }
    },
    failure: () => failure,
    repliedWithText: () => wroteText,
    didWork: () => worked,
    lockMode(modeId) {
      lockedMode = modeId;
    },
    unsafeModeChange: () => unsafeMode,
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
