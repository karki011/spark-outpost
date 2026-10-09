import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeTerminalLaunchRequest, NativeTerminalProvider } from '@spark-outpost/contracts';
import { nativeTerminalTarget } from '../persistence/native-terminal-settings.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import { sendUserMessage } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { loadRunInput } from '../workflow/run-input.ts';
import { withPublishNote } from '../workflow/publish-context.ts';
import { placeChat } from '../orchestration/chat-place.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import type { NativeTerminalRow } from '../persistence/native-terminals.ts';
import { shellFolder } from './shell-folder.ts';
import { nativeModeArgs } from './native-launch.ts';
import { nativeLaunchError, NativeRuntimeError } from './native-control.ts';
import {
  failNativeLaunchRun,
  requeueNativeLaunchRun,
} from '../persistence/native-terminal-turns.ts';

const SPARK_SESSION_NOTE =
  'This is a Spark Terminal session. Spark MCP tools provide the linked ticket, task, project, checks and action confirmations. Answer native CLI questions and approvals in this terminal.';

export async function prepareNativeSession(
  deps: {
    db: Db;
    workspaceId: string;
    dataDir: string;
    channel: string;
    branchPrefix?: string;
    place?: typeof placeChat;
  },
  conversationId: string,
  provider: NativeTerminalProvider,
  request: NativeTerminalLaunchRequest,
  previous: NativeTerminalRow | null,
) {
  let runId: string | null = null;
  try {
    if (request.prompt) {
      const target = await nativeTerminalTarget(deps.db, conversationId, provider);
      nativeModeArgs(provider, target.agentMode!);
      const sent = await sendUserMessage(
        deps.db,
        conversationId,
        {
          id: request.messageId ?? randomUUID(),
          content: request.prompt,
        },
        target,
      );
      runId = sent.run.id;
    }
    const runs = await deps.db.query<{ id: string; status: string }>(
      `SELECT r.id, r.status FROM runs r WHERE r.conversation_id = $1 AND r.provider = $2
       AND r.parent_run_id IS NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE run_id = r.id)
       AND ($3::uuid IS NULL OR r.id = $3)
       ORDER BY (r.status = 'queued') DESC, r.created_at DESC LIMIT 1`,
      [conversationId, provider, runId],
    );
    const existing = runs.rows[0];
    const retried =
      !request.resume &&
      (existing?.status === 'failed' || existing?.status === 'outcome_unknown') &&
      !previous?.native_session_id &&
      (await requeueNativeLaunchRun(deps.db, existing.id));
    if (!existing || (!request.resume && existing.status !== 'queued' && !retried)) {
      throw new NativeRuntimeError(
        'Give this terminal session a first message before starting it.',
      );
    }
    if (!runId && (existing.status === 'queued' || retried)) runId = existing.id;
    let input = await loadRunInput(deps.db, existing.id);
    nativeModeArgs(provider, input.agentMode ?? (provider === 'claude' ? 'auto' : 'agent'));
    const placed = await (deps.place ?? placeChat)(
      {
        db: deps.db,
        branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
      },
      { ...input, mode: 'do' },
      true,
    );
    input = { ...placed.input, mode: input.mode };
    let folder = await shellFolder(deps.db, deps.workspaceId, conversationId);
    if (!input.projectRoots.length) {
      const cwd =
        previous?.cwd ?? join(deps.dataDir, deps.channel, 'terminal-workspaces', conversationId);
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      folder = { cwd, label: 'Spark session', kind: 'home', note: null };
    } else if (input.projectRoots[0] !== folder.cwd) {
      folder = {
        cwd: input.projectRoots[0]!,
        label: 'Session worktree',
        kind: 'worktree',
        note: placed.note,
      };
    }
    const prefs = await sparkPreferences(deps.db, deps.workspaceId);
    const prompt = runId
      ? [input.prompt, prefs.sparkEnabled ? await withPublishNote(deps.db, input) : '']
          .filter(Boolean)
          .join('\n\n')
      : '';
    const instructions = [
      prefs.agentInstructions ?? '',
      prefs.sparkEnabled ? SPARK_SESSION_NOTE : '',
    ]
      .filter((text) => text.trim())
      .join('\n\n');
    return {
      input,
      folder,
      runId,
      prompt,
      workflowEnabled: prefs.sparkEnabled,
      instructions,
    };
  } catch (error) {
    const failure = nativeLaunchError(error);
    if (runId) await failNativeLaunchRun(deps.db, runId, failure.message);
    throw failure;
  }
}
