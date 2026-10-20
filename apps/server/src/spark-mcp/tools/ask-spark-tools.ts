import { z } from 'zod';
import {
  ASK_SPARK_SUMMARY_MAX,
  ASK_SPARK_TEXT_MAX,
  askSparkAnswerSchema,
  parseChatReference,
  ticketSourceIdSchema,
  type AskSparkAction,
} from '@spark-outpost/contracts';
import { getApproval } from '../../persistence/approvals.ts';
import { ASK_SPARK_REFUSALS, assistantChatOf } from '../actions/ask-spark-limits.ts';
import { chatFacts } from '../actions/ask-spark-perform.ts';
import { proposeAction } from '../actions/confirm.ts';
import { sparkTool, SparkToolError, uuidInput, type SparkToolContext } from '../tool.ts';
import { chatIdInput } from './chat-tools.ts';
import { findProject } from './project-tools.ts';

const ACTS_NOTE =
  'Spark runs it at once when the user set Ask Spark to Act, and otherwise shows them a card with Do it and Don’t; say what you asked for and wait for the card. Use it only when the user asked you to.';

const SENT_NOTE =
  'The message reaches that chat as sent by Ask Spark, never as the user’s own message, so it cannot authorize a push, a pull request or a Spark action there.';

function brief(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function summary(text: string): string {
  return text.slice(0, ASK_SPARK_SUMMARY_MAX);
}

function action(fields: Partial<AskSparkAction> & Pick<AskSparkAction, 'op' | 'summary'>) {
  return {
    action: 'ask_spark' as const,
    conversationId: null,
    projectId: null,
    approvalId: null,
    answer: null,
    ticket: null,
    text: null,
    ...fields,
  };
}

async function targetChat(context: SparkToolContext, reference: string | undefined) {
  const id = reference ? parseChatReference(reference) : null;
  if (!id) throw new SparkToolError('Pass the chat id or chat link from spark_chats.');
  if (id === (await assistantChatOf(context.deps.db, context.scope.workspaceId))) {
    throw new SparkToolError(ASK_SPARK_REFUSALS.assistantChat);
  }
  const chat = await chatFacts(context.deps.db, context.scope.workspaceId, id);
  if (chat.terminal) throw new SparkToolError(ASK_SPARK_REFUSALS.terminal);
  return { id, title: chat.title };
}

const startChatTool = sparkTool({
  name: 'spark_start_chat',
  title: 'Start a chat',
  acts: true,
  assistantOnly: true,
  description: `Start a new chat in a project with a task as its first message. ${SENT_NOTE} ${ACTS_NOTE}`,
  input: {
    project: z.string().max(200).describe('Project name or id (spark_projects).'),
    task: z.string().trim().min(1).max(ASK_SPARK_TEXT_MAX),
  },
  run: async (args, context) => {
    const project = await findProject(context, args.project);
    return proposeAction(
      context,
      action({
        op: 'start_chat',
        summary: summary(`Start a chat in ${project.name}: ${brief(args.task)}`),
        projectId: project.id,
        text: args.task,
      }),
    );
  },
});

const sendTool = sparkTool({
  name: 'spark_send_to_chat',
  title: 'Send a message to a chat',
  acts: true,
  assistantOnly: true,
  description: `Send a follow-up message to another chat; it runs after that chat's current turn. ${SENT_NOTE} ${ACTS_NOTE}`,
  input: { chat: chatIdInput, message: z.string().trim().min(1).max(ASK_SPARK_TEXT_MAX) },
  run: async (args, context) => {
    const chat = await targetChat(context, args.chat);
    return proposeAction(
      context,
      action({
        op: 'send_message',
        summary: summary(`Send to “${chat.title}”: ${brief(args.message)}`),
        conversationId: chat.id,
        text: args.message,
      }),
    );
  },
});

const stopTool = sparkTool({
  name: 'spark_stop_chat',
  title: 'Stop a chat',
  acts: true,
  assistantOnly: true,
  description: `Stop the turn running in another chat. ${ACTS_NOTE}`,
  input: { chat: chatIdInput },
  run: async (args, context) => {
    const chat = await targetChat(context, args.chat);
    return proposeAction(
      context,
      action({
        op: 'stop_turn',
        summary: summary(`Stop “${chat.title}”`),
        conversationId: chat.id,
      }),
    );
  },
});

const archiveTool = sparkTool({
  name: 'spark_archive_chat',
  title: 'Archive a chat',
  acts: true,
  assistantOnly: true,
  description: `Archive another chat. ${ACTS_NOTE}`,
  input: { chat: chatIdInput },
  run: async (args, context) => {
    const chat = await targetChat(context, args.chat);
    return proposeAction(
      context,
      action({
        op: 'archive_chat',
        summary: summary(`Archive “${chat.title}”`),
        conversationId: chat.id,
      }),
    );
  },
});

const answerTool = sparkTool({
  name: 'spark_answer_card',
  title: 'Answer an approval card',
  acts: true,
  assistantOnly: true,
  description: `Answer another chat's waiting approval card with Allow once or Deny (card ids come from spark_attention or spark_chat). Cards that need a press and hold (force push, git hooks or config, sending a secret), instruction files, Mac control, calendar and sign-in cards stay with the user, and a spoken question never answers a card. ${ACTS_NOTE}`,
  input: { card: uuidInput, answer: askSparkAnswerSchema },
  run: async (args, context) => {
    const card = await getApproval(context.deps.db, args.card);
    if (!card) throw new SparkToolError(ASK_SPARK_REFUSALS.notWaiting);
    const verb = args.answer === 'allow_once' ? 'Allow once' : 'Deny';
    return proposeAction(
      context,
      action({
        op: 'answer_card',
        summary: summary(`${verb}: ${card.title}`),
        approvalId: card.id,
        answer: args.answer,
      }),
    );
  },
});

const pauseTool = sparkTool({
  name: 'spark_pause',
  title: 'Pause or resume Spark',
  acts: true,
  assistantOnly: true,
  description: `Pause Spark (no new turns start until resumed) or resume it. ${ACTS_NOTE}`,
  input: { paused: z.boolean() },
  run: (args, context) =>
    proposeAction(
      context,
      action({
        op: args.paused ? 'pause_spark' : 'resume_spark',
        summary: args.paused ? 'Pause Spark' : 'Resume Spark',
      }),
    ),
});

const startTicketTool = sparkTool({
  name: 'spark_start_ticket',
  title: 'Start work on a ticket',
  acts: true,
  assistantOnly: true,
  needs: 'tickets',
  description: `Start work on a Jira or Linear ticket in a new chat, as Start work in Tickets does, and move it to in progress. ${SENT_NOTE} ${ACTS_NOTE}`,
  input: {
    source: ticketSourceIdSchema,
    key: z.string().trim().min(1).max(100),
    project: z.string().max(200).optional().describe('Project name or id for the new chat.'),
  },
  run: async (args, context) => {
    const project = args.project ? await findProject(context, args.project) : null;
    return proposeAction(
      context,
      action({
        op: 'start_ticket',
        summary: summary(
          `Start work on ${args.key}${project ? ` in ${project.name}` : ''} in a new chat`,
        ),
        projectId: project?.id ?? null,
        ticket: { source: args.source, key: args.key },
      }),
    );
  },
});

export const askSparkTools = [
  startChatTool,
  sendTool,
  stopTool,
  archiveTool,
  answerTool,
  pauseTool,
  startTicketTool,
];
