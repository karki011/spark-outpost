import type * as acp from '@agentclientprotocol/sdk';
import type { ConversationTurn, ProviderTurn, TurnAttachment } from '../../providers/provider.ts';
import { TITLE_REQUEST } from '../../titles/title-line.ts';
import type { SlashPrompt } from './slash-commands.ts';

export const HISTORY_BUDGET_BYTES = 36_000;

export const CHAT_ONLY_NOTE =
  'You are answering in a Spark Outpost chat that has no project folder. You cannot read or change files, run commands, or browse the web here, so do not attempt tool calls. Reply in plain text and Markdown only.';

export const CHAT_TOOLS_NOTE =
  "You are answering in a Spark Outpost chat that has no project folder. You cannot read or change files, run shell commands, or browse the web here. You may call the tools this session offers, such as Spark Outpost's own spark_* tools for questions about Spark; do not try any other tools. Reply in plain text and Markdown.";

const ASK_COMMANDS =
  'Spark Outpost runs read-only commands directly and may ask the user before other commands, so a command may wait or be denied.';
const ASK_NO_CHANGES =
  'If the request needs file changes, say so and tell the user to ask for the change in a message, such as "make the change", or to switch the agent\'s mode when a read-only mode is what blocks it.';

export function projectNote(roots: readonly string[], commands = false): string {
  const [primary, ...others] = roots;
  const single = others.length === 0;
  const where = single ? 'this folder' : 'these folders';
  const reads = commands
    ? `You may read files and run shell commands inside ${where}: ${ASK_COMMANDS}`
    : `You may read files inside ${where}.`;
  const through = commands ? ' (including through commands)' : '';
  const outside = single ? 'it' : 'them';
  const limits = `You must not create, change, or delete files${through}, and you must not read files outside ${outside}. ${ASK_NO_CHANGES}`;
  if (single) {
    return `You are answering in a Spark Outpost chat linked to the project folder ${primary} in Ask mode. ${reads} ${limits} Reply in plain text and Markdown.`;
  }
  const listed = [`${primary} (primary, your working directory)`, ...others].join(', ');
  return `You are answering in a Spark Outpost chat linked to these project folders in Ask mode: ${listed}. ${reads} ${limits} Relative paths are inside the primary folder. Reply in plain text and Markdown.`;
}

export function doProjectNote(roots: readonly string[]): string {
  const [primary, ...others] = roots;
  const extra =
    others.length > 0
      ? ` These folders are linked too, and relative paths are inside the primary folder: ${others.join(', ')}.`
      : '';
  return `You are working in a Spark Outpost chat linked to the project folder ${primary} (your working directory) in Do mode. You may read and change files and run commands inside the linked folders. Spark Outpost asks the user before each action their settings require, so a request may wait or be denied; if an action is denied, do not retry it another way, explain what you could not do. Do not read or change files outside the linked folders.${extra} Reply in plain text and Markdown.`;
}

export interface PromptSupport {
  image: boolean;
  embeddedContext: boolean;
}

export interface PromptOptions {
  attachments?: readonly TurnAttachment[];
  support?: PromptSupport;
  budget?: number;
  projectRoots?: readonly string[];
  changesAllowed?: boolean;
  commandsAllowed?: boolean;
  toolsAvailable?: boolean;
}

type Part = string | acp.ContentBlock;

const TEXT_ONLY: PromptSupport = { image: false, embeddedContext: false };

const speaker = (turn: ConversationTurn) => (turn.role === 'user' ? 'User' : 'Assistant');

const textBytes = (attachments: readonly TurnAttachment[] = []) =>
  attachments
    .filter((attachment) => attachment.kind === 'text')
    .reduce((total, attachment) => total + attachment.data.length, 0);

function fenced(name: string, text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `Attached file ${name}:\n${fence}\n${text}\n${fence}`;
}

function attachmentParts(attachment: TurnAttachment, support: PromptSupport): Part[] {
  if (attachment.kind === 'image') {
    if (!support.image) return [`[Image not shown: ${attachment.name}]`];
    return [
      `[Attached image: ${attachment.name}]`,
      { type: 'image', data: attachment.data.toString('base64'), mimeType: attachment.mediaType },
    ];
  }
  const text = attachment.data.toString('utf8');
  if (!support.embeddedContext) return [fenced(attachment.name, text)];
  return [
    {
      type: 'resource',
      resource: {
        uri: `attachment:///${encodeURIComponent(attachment.name)}`,
        mimeType: attachment.mediaType,
        text,
      },
    },
  ];
}

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

export function conversationBlocks(
  history: readonly ConversationTurn[],
  prompt: string,
  options: PromptOptions = {},
): acp.ContentBlock[] {
  prompt = prompt.trim() || 'Look at the attached files.';
  const support = options.support ?? TEXT_ONLY;
  const current = options.attachments ?? [];
  const budget = Math.max(0, (options.budget ?? HISTORY_BUDGET_BYTES) - textBytes(current));
  const currentParts = current.flatMap((attachment) => attachmentParts(attachment, support));
  const { kept, omitted } = keptHistory(history, budget);
  const roots = options.projectRoots ?? [];
  const projectIntro = options.changesAllowed
    ? doProjectNote(roots)
    : projectNote(roots, options.commandsAllowed === true);
  const chatIntro = options.toolsAvailable ? CHAT_TOOLS_NOTE : CHAT_ONLY_NOTE;
  const intro = roots.length > 0 ? projectIntro : chatIntro;
  if (kept.length === 0 && omitted === 0) {
    return toBlocks([intro, prompt, ...currentParts]);
  }
  const note =
    omitted > 0
      ? [
          `(${omitted} earlier ${omitted === 1 ? 'message was' : 'messages were'} left out to fit the context budget.)`,
        ]
      : [];
  const turns = kept.flatMap((turn) => [
    `${speaker(turn)}: ${turn.content}`,
    ...(turn.attachments ?? []).flatMap((attachment) => attachmentParts(attachment, support)),
  ]);
  return toBlocks([
    intro,
    'This is a continuing conversation. Earlier messages, oldest first:',
    ...note,
    ...turns,
    'Reply to the latest message:',
    prompt,
    ...currentParts,
  ]);
}

export function followUpBlocks(prompt: string, options: PromptOptions = {}): acp.ContentBlock[] {
  const text = prompt.trim() || 'Look at the attached files.';
  const support = options.support ?? TEXT_ONLY;
  const parts = (options.attachments ?? []).flatMap((attachment) =>
    attachmentParts(attachment, support),
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

export function promptSupport(init: acp.InitializeResponse): PromptSupport {
  const capabilities = init.agentCapabilities?.promptCapabilities;
  return {
    image: capabilities?.image === true,
    embeddedContext: capabilities?.embeddedContext === true,
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
