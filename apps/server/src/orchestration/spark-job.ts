import {
  SPARK_HANDOFF_NOTE_MAX,
  clipAtWord,
  sparkWho,
  type ChatTicket,
  type TaskOverview,
} from '@spark-outpost/contracts';

export const SPARK_JOB_HEADER = '# A job handed to you by the user';
export const SPARK_HANDOFF_HEADER = '# Hand-off note from Spark Outpost';
const LAST_REPLY_MAX = 1500;
const TICKETS_SHOWN = 5;

export interface SparkJob {
  spark: { name: string; role: string };
  request: string;
  hasProject: boolean;
  lastReply: string | null;
  task: Pick<TaskOverview, 'title' | 'summary'> | null;
  tickets: readonly Pick<ChatTicket, 'key' | 'title' | 'url'>[];
}

function contextLines(job: SparkJob): string[] {
  const lines: string[] = [];
  if (job.task) {
    const plan = job.task.summary.total > 0 ? ` (${job.task.summary.text})` : '';
    lines.push(`- Current task: ${job.task.title}${plan}`);
  }
  for (const ticket of job.tickets.slice(0, TICKETS_SHOWN)) {
    lines.push(`- Linked ticket: ${ticket.key} ${ticket.title} ${ticket.url}`);
  }
  if (job.hasProject) {
    lines.push(
      '- The change so far: run `git status` and `git diff` in the project folder to see it.',
    );
  }
  if (job.lastReply) {
    lines.push(
      `- The main agent's last reply, shortened:\n${clipAtWord(job.lastReply, LAST_REPLY_MAX)}`,
    );
  }
  return lines;
}

export function sparkJobPrompt(job: SparkJob): string {
  const who = sparkWho(job.spark);
  const access = job.hasProject
    ? 'You can read the project and run read-only commands. You cannot change files, push or open pull requests.'
    : 'This chat has no project folder, so work from the message and the context below.';
  const context = contextLines(job);
  return [
    SPARK_JOB_HEADER,
    `You are ${who}, a Spark teammate. The user handed you one job from another chat by mentioning you. You have your own context: you have not seen that chat. Do this job only, then reply with your result. The chat's main agent receives a short summary of your reply. ${access}`,
    ...(context.length > 0 ? ['', 'Context from the chat:', ...context] : []),
    '',
    "The user's message:",
    job.request,
  ].join('\n');
}

export interface SparkResult {
  spark: { name: string; role: string };
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'lease_lost';
  text: string;
  error: string | null;
}

function resultLine(result: SparkResult, share: number): string {
  const who = sparkWho(result.spark);
  if (result.outcome === 'cancelled') return `${who} was stopped before it replied.`;
  if (result.outcome !== 'succeeded') {
    return `${who} could not finish: ${result.error ?? 'the run failed'}.`;
  }
  const reply = result.text.trim();
  if (!reply) return `${who} finished without a reply.`;
  return `${who} replied:\n${clipAtWord(reply, share)}`;
}

export function handoffNote(results: readonly SparkResult[], continues: boolean): string {
  const share = Math.floor(SPARK_HANDOFF_NOTE_MAX / Math.max(1, results.length));
  const names = results.map((result) => result.spark.name).join(', ');
  const next = continues
    ? `Do the rest of the user's message now; do not redo the part handed to ${names}.`
    : `The main agent did not run for this message.`;
  return [
    SPARK_HANDOFF_HEADER,
    `The user handed part of this message to ${names}, who worked as a separate read-only subagent with its own context. Replies are shortened here; read the full reply with the spark_chat tool (sparkReplies) when you need it. ${next}`,
    '',
    ...results.map((result) => resultLine(result, share)),
  ].join('\n');
}
