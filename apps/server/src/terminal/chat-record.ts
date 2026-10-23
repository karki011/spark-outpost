import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { createRailWatch } from '../agents/acp/rail-watch.ts';
import { createCommandTracker } from '../agents/acp/command-output.ts';
import { createTurnMapper } from '../agents/acp/subagent-updates.ts';
import { mentionsSecretFile, withoutFileContent } from '../audit/redact.ts';
import { createRedactionFilter } from '../audit/redact-stream.ts';
import { projectSecretValues, withoutSecretValues } from '../audit/secret-values.ts';
import { scannedObserver } from '../observations/output-scan.ts';
import { createRunObservations } from '../observations/run-observations.ts';
import { watchedSends } from '../observations/send-watch.ts';
import { recordKeptChanges } from '../outcomes/record.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { recordsTerminalLikeChat } from '../persistence/native-terminal-settings.ts';
import { appendNativeRun, type NativeFence } from '../persistence/native-terminal-turns.ts';
import { runChanges, snapshotRun } from '../projects/run-changes.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { createAuditRecorder } from '../workflow/audit-recorder.ts';
import { createCommandRecorder } from '../workflow/command-recorder.ts';
import { closeMessage } from '../workflow/execute-run.ts';
import { writeKeptRecord } from '../workflow/kept-record-writer.ts';
import { startRailFlags } from '../workflow/rail-flags.ts';
import { createReplyText } from '../workflow/reply-text.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { createTurnEvents } from '../workflow/turn-events.ts';
import {
  permissionAsked,
  sessionUpdateMessage,
  toolCallEnded,
  toolCallStarted,
  type RecordedTool,
} from './chat-record-updates.ts';
import type { LiveSession } from './native-runtime-types.ts';

const AGENT_NAME = 'Claude Code';

export interface ToolEnd {
  id: string;
  output: string;
  failed: boolean;
  asked: boolean;
}

export interface ChatRecord {
  runId: string;
  toolStarted(tool: RecordedTool): Promise<void>;
  toolEnded(end: ToolEnd): Promise<void>;
  replied(key: string, text: string): Promise<void>;
  finish(): Promise<void>;
  kept(): Promise<void>;
  discard(): void;
}

export async function startChatRecord(
  db: Db,
  fence: NativeFence & { cwd: string },
  input: RunInput,
): Promise<ChatRecord> {
  const runId = input.identity.runId;
  const roots = input.projectRoots[0] === fence.cwd ? input.projectRoots : [fence.cwd];
  const cwd = roots[0] ?? process.cwd();
  const secretValues = await projectSecretValues(roots);
  const append: Parameters<typeof closeMessage>[0] = (event, options) =>
    appendNativeRun(
      db,
      { ...fence, runId },
      withoutSecretValues(event, secretValues),
      options && withoutSecretValues(options, secretValues),
    );
  const audit = createAuditRecorder({
    write: (entries) =>
      insertFinishedRunEntries(
        db,
        runId,
        entries.map((entry) => ({
          ...entry,
          payload: withoutSecretValues(entry.payload, secretValues),
        })),
      ),
  });
  const observations = createRunObservations({ db, runId, audit });
  const observer = watchedSends(scannedObserver(audit, secretValues, observations.record), {
    db,
    runId,
    mode: 'do',
    projectRoots: roots,
    observations,
  });
  const snapshot = roots[0] ? await snapshotRun(db, runId, roots[0]) : null;
  const rails = await startRailFlags({ db, runId, projectRoots: roots, audit });
  const watch = createRailWatch({
    roots: roots.map((path) => ({ path, ignore: [] })),
    cwd,
    cli: 'claude',
  });
  const mapper = createTurnMapper(AGENT_NAME, false);
  const tracker = createCommandTracker(false);
  const reply = createReplyText(append);
  const redaction = createRedactionFilter(secretValues);
  const replySoFar = () => ({ shown: reply.result().text, held: redaction.pending() });
  const commands = createCommandRecorder({
    db,
    runId,
    append,
    secretValues,
    projectRoots: roots,
    replySoFar,
  });
  const events = createTurnEvents({ append, secretValues, replySoFar });
  const tools = new Map<string, RecordedTool>();
  const done = new Set<string>();
  let replies = 0;

  const produced = async (outputs: ProviderOutput[]) => {
    for (const output of outputs) {
      await events.observe(output);
      await commands.observe(output);
    }
  };
  const see = async (update: SessionUpdate) => {
    observer.message('from_agent', sessionUpdateMessage(update));
    const observed = await watch.observe(update);
    for (const flag of observed.rails) await rails.record(flag);
    for (const label of observed.secretReads) observations.record({ source: 'secret_file', label });
    await produced([...mapper.map(update), ...tracker.see(update)]);
  };

  return {
    runId,
    async toolStarted(tool) {
      if (tools.has(tool.id) || done.has(tool.id)) return;
      const input = mentionsSecretFile(tool.input) ? withoutFileContent(tool.input) : tool.input;
      const kept = { ...tool, input };
      tools.set(tool.id, kept);
      await see(toolCallStarted(kept, cwd));
    },
    async toolEnded(end) {
      const tool = tools.get(end.id);
      if (!tool) return;
      tools.delete(end.id);
      done.add(end.id);
      if (end.asked) {
        watch.asked(tool.id);
        observer.message('from_agent', permissionAsked(tool, cwd));
      }
      await see(toolCallEnded(tool, end.output, end.failed));
    },
    async replied(key, text) {
      if (done.has(key)) return;
      done.add(key);
      const shown = replies > 0 ? `\n\n${text}` : text;
      replies += 1;
      await reply.say(redaction.push(shown));
    },
    async finish() {
      await events.close();
      await commands.close();
      await reply.say(redaction.finish());
      await closeMessage(append, reply.result(), true);
      await rails.finish();
      await observations.settled();
      await audit.close();
      if (!snapshot) return;
      const changes = await runChanges(db, input.workspaceId, runId, true);
      await writeKeptRecord(
        { db, append },
        { runId, workspaceId: input.workspaceId, level: input.level },
        { files: changes.files },
      );
    },
    async kept() {
      if (snapshot) await recordKeptChanges(db, input.workspaceId, runId);
    },
    discard() {
      audit.discard();
    },
  };
}

export async function chatRecordFor(
  db: Db,
  session: LiveSession,
  runId: string,
): Promise<ChatRecord | null> {
  const context = session.context;
  if (session.row.provider !== 'claude' || context?.input.identity.runId !== runId) return null;
  if (session.chatRecord?.runId === runId) return session.chatRecord.record;
  const recording = await recordsTerminalLikeChat(db, session.row.conversation_id);
  const record = recording ? await startChatRecord(db, session.row, context.input) : null;
  session.chatRecord = { runId, record };
  return record;
}

export function takeChatRecord(session: LiveSession): ChatRecord | null {
  const record = session.chatRecord?.record ?? null;
  delete session.chatRecord;
  return record;
}
