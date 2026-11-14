import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { ConversationTurn, ProviderTurn, TurnAttachment } from '../../providers/provider.ts';
import { TITLE_REQUEST } from '../../titles/title-line.ts';
import type { SlashPrompt } from './slash-commands.ts';
import {
  attachmentParts,
  earlierAttachmentParts,
  textBytes,
  type AttachmentPaths,
  type Part,
  type PromptSupport,
} from './attachment-parts.ts';

export const HISTORY_BUDGET_BYTES = 36_000;

export const CHAT_ONLY_NOTE =
  'You are answering in a Spark Outpost chat that has no project folder. You cannot read or change files, run commands, or browse the web here, so do not attempt tool calls. Reply in plain text and Markdown only.';

export const CHAT_TOOLS_NOTE =
  "You are answering in a Spark Outpost chat that has no project folder. You cannot read or change files, run shell commands, or browse the web here. You may call the tools this session offers, such as Spark Outpost's own spark_* tools for questions about Spark; do not try any other tools. Reply in plain text and Markdown.";

const ASK_COMMANDS =
  'Spark Outpost runs read-only commands directly and may ask the user before other commands, so a command may wait or be denied.';
const ASK_NO_CHANGES =
  'If the request needs file changes, say so and tell the user to ask for the change in a message, such as "make the change", or to switch the agent\'s mode when a read-only mode is what blocks it.';

function crewNote(folders: readonly string[]): string {
  if (folders.length === 0) return '';
  return ` Spark's crew folders (${folders.join(', ')}) are read-only.`;
}

function readOnlyNote(folders: readonly string[]): string {
  if (folders.length === 0) return '';
  return ` Spark's crew folders are the exception: you may read files in ${folders.join(', ')}, but never change them.`;
}

export function projectNote(
  roots: readonly string[],
  commands = false,
  readOnly: readonly string[] = [],
): string {
  const [primary, ...others] = roots;
  const single = others.length === 0;
  const where = single ? 'this folder' : 'these folders';
  const reads = commands
    ? `You may read files and run shell commands inside ${where}: ${ASK_COMMANDS}`
    : `You may read files inside ${where}.`;
  const through = commands ? ' (including through commands)' : '';
  const outside = single ? 'it' : 'them';
  const limits = `You must not create, change, or delete files${through}. You may read files outside ${outside} when the task needs it.${crewNote(readOnly)} ${ASK_NO_CHANGES}`;
  if (single) {
    return `You are answering in a Spark Outpost chat linked to the project folder ${primary} in Ask mode. ${reads} ${limits} Reply in plain text and Markdown.`;
  }
  const listed = [`${primary} (primary, your working directory)`, ...others].join(', ');
  return `You are answering in a Spark Outpost chat linked to these project folders in Ask mode: ${listed}. ${reads} ${limits} Relative paths are inside the primary folder. Reply in plain text and Markdown.`;
}

export function doProjectNote(roots: readonly string[], readOnly: readonly string[] = []): string {
  const [primary, ...others] = roots;
  const extra =
    others.length > 0
      ? ` These folders are linked too, and relative paths are inside the primary folder: ${others.join(', ')}.`
      : '';
  return `You are working in a Spark Outpost chat linked to the project folder ${primary} (your working directory) in Do mode. You may read and change files and run commands inside the linked folders. Spark Outpost asks the user before each action their settings require, so a request may wait or be denied; if an action is denied, do not retry it another way, explain what you could not do. You may read files outside the linked folders when the task needs it; changing files outside them asks the user first.${crewNote(readOnly)}${extra} Reply in plain text and Markdown.`;
}

export function chatFolderNote(
  folder: string,
  changes: boolean,
  readOnly: readonly string[] = [],
): string {
  const may = changes
    ? 'You may read and change files and run commands inside it.'
    : 'You may read files inside it; you must not create, change, or delete files.';
  return `You are working in a Spark Outpost chat with no project. Your working directory ${folder} is this chat's own private folder, not the user's code. ${may} Files you create there are shown to the user as attachments of this turn, so save anything they asked for (a CSV, an image, a document) as a file. It is not a git repository and nothing in it is pushed. Spark Outpost asks the user before each action their settings require. Do not read or change files outside this folder.${readOnlyNote(readOnly)} Reply in plain text and Markdown.`;
}

export interface PromptOptions {
  attachments?: readonly TurnAttachment[];
  support?: PromptSupport;
  paths?: AttachmentPaths;
  budget?: number;
  projectRoots?: readonly string[];
  chatFolder?: boolean;
  changesAllowed?: boolean;
  commandsAllowed?: boolean;
  toolsAvailable?: boolean;
  readOnlyFolders?: readonly string[];
}

export const TEXT_ONLY: PromptSupport = { image: false, embeddedContext: false, pdf: false };

export const commandFirstSupport = (support: PromptSupport): PromptSupport => ({
  ...support,
  embeddedContext: false,
  pdf: false,
});

const speaker = (turn: ConversationTurn) => (turn.role === 'user' ? 'User' : 'Assistant');

function keptHistory(history: readonly ConversationTurn[], budget: number) {
  const kept: ConversationTurn[] = [];
  let used = 0;
  let omitted = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const turn = history[index];
    if (!turn) continue;
    const size =
      Buffer.byteLength(`${speaker(turn)}: ${turn.content}`) + textBytes(turn.attachments);
    if (used + size > budget) {
      omitted = index + 1;
      break;
    }
    kept.unshift(turn);
    used += size;
  }
  return { kept, omitted };
}

function toBlocks(parts: readonly Part[]): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length > 0) blocks.push({ type: 'text', text: text.join('\n\n') });
    text = [];
  };
  for (const part of parts) {
    if (typeof part === 'string') text.push(part);
    else {
      flush();
      blocks.push(part);
    }
  }
  flush();
  return blocks;
}

export function contextSteps(
  history: readonly ConversationTurn[],
  options: PromptOptions = {},
): string[] {
  const current = options.attachments ?? [];
  const budget = Math.max(0, (options.budget ?? HISTORY_BUDGET_BYTES) - textBytes(current));
  const { kept, omitted } = keptHistory(history, budget);
  const steps = current.map((attachment) =>
    attachment.kind === 'image'
      ? `Looked at \`${attachment.name}\``
      : attachment.kind === 'file'
        ? `Attached \`${attachment.name}\``
        : `Read \`${attachment.name}\``,
  );
  const earlier = kept.flatMap((turn) => turn.attachments ?? []).length;
  if (kept.length > 0) {
    const files = earlier > 0 ? ` and ${earlier} ${earlier === 1 ? 'file' : 'files'}` : '';
    steps.push(
      `Recalled ${kept.length} earlier ${kept.length === 1 ? 'message' : 'messages'}${files}`,
    );
  }
  if (omitted > 0) {
    steps.push(
      `Left out ${omitted} older ${omitted === 1 ? 'message' : 'messages'} to fit the context`,
    );
  }
  return steps;
}

function conversationParts(
  history: readonly ConversationTurn[],
  prompt: string,
  options: PromptOptions,
): Part[] {
  const support = options.support ?? TEXT_ONLY;
  const current = options.attachments ?? [];
  const budget = Math.max(0, (options.budget ?? HISTORY_BUDGET_BYTES) - textBytes(current));
  const currentParts = current.flatMap((attachment) =>
    attachmentParts(attachment, support, options.paths),
  );
  const { kept, omitted } = keptHistory(history, budget);
  const roots = options.projectRoots ?? [];
  const projectIntro = options.chatFolder
    ? chatFolderNote(roots[0] ?? '', options.changesAllowed === true, options.readOnlyFolders)
    : options.changesAllowed
      ? doProjectNote(roots, options.readOnlyFolders)
      : projectNote(roots, options.commandsAllowed === true, options.readOnlyFolders);
  const chatIntro = options.toolsAvailable ? CHAT_TOOLS_NOTE : CHAT_ONLY_NOTE;
  const intro = roots.length > 0 ? projectIntro : chatIntro;
  const asked = prompt ? [prompt] : [];
  if (kept.length === 0 && omitted === 0) {
    return [intro, ...asked, ...currentParts];
  }
  const note =
    omitted > 0
      ? [
          `(${omitted} earlier ${omitted === 1 ? 'message was' : 'messages were'} left out to fit the context budget.)`,
        ]
      : [];
  const turns = kept.flatMap((turn) => [
    `${speaker(turn)}: ${turn.content}`,
    ...(turn.attachments ?? []).flatMap((attachment) =>
      earlierAttachmentParts(attachment, support),
    ),
  ]);
  return [
    intro,
    'This is a continuing conversation. Earlier messages, oldest first:',
    ...note,
    ...turns,
    'Reply to the latest message:',
    ...asked,
    ...currentParts,
  ];
}

export function conversationBlocks(
  history: readonly ConversationTurn[],
  prompt: string,
  options: PromptOptions = {},
): acp.ContentBlock[] {
  return toBlocks(
    conversationParts(history, prompt.trim() || 'Look at the attached files.', options),
  );
}

export function commandFirstBlocks(
  history: readonly ConversationTurn[],
  before: string,
  command: string,
  options: PromptOptions = {},
): acp.ContentBlock[] {
  const support = commandFirstSupport(options.support ?? TEXT_ONLY);
  const context = toBlocks(conversationParts(history, before.trim(), { ...options, support }));
  return [...context, { type: 'text', text: command }];
}

export function followUpBlocks(prompt: string, options: PromptOptions = {}): acp.ContentBlock[] {
  const text = prompt.trim() || 'Look at the attached files.';
  const support = options.support ?? TEXT_ONLY;
  const parts = (options.attachments ?? []).flatMap((attachment) =>
    attachmentParts(attachment, support, options.paths),
  );
  return toBlocks([text, ...parts]);
}

export function conversationPrompt(
  history: readonly ConversationTurn[],
  prompt: string,
  budget = HISTORY_BUDGET_BYTES,
): string {
  return conversationBlocks(history, prompt, { budget })
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n\n');
}

export function promptSupport(init: acp.InitializeResponse, inlinePdf = false): PromptSupport {
  const capabilities = init.agentCapabilities?.promptCapabilities;
  const embeddedContext = capabilities?.embeddedContext === true;
  return {
    image: capabilities?.image === true,
    embeddedContext,
    pdf: embeddedContext && inlinePdf,
  };
}

export function promptText(
  turn: ProviderTurn,
  request: string,
  slash: SlashPrompt,
  continued: boolean,
): string {
  const asked = continued ? slash.text : request;
  if (slash.kind === 'command') return asked;
  const before = [continued ? null : turn.preamble, turn.turnPreamble].filter(Boolean);
  const primed = [...before, asked].join('\n\n');
  return turn.askTitle ? `${primed}\n\n${TITLE_REQUEST}` : primed;
}

export function commandPreamble(turn: ProviderTurn): string {
  const title = turn.askTitle ? TITLE_REQUEST : null;
  return [turn.preamble, turn.turnPreamble, title].filter(Boolean).join('\n\n');
}
