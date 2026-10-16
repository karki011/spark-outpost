import {
  modeForLegacy,
  type AssistantRunsOn,
  type AssistantSession,
  type AssistantSettings,
  type AssistantSettingsView,
  type ProviderId,
} from '@spark-outpost/contracts';
import { cardFor } from '../model-cards/cards.ts';
import { usedPercent, readingOf } from '../compaction/policy.ts';
import {
  draftChatSettings,
  getCapabilities,
  resolveChatSettings,
  updateChatSettings,
} from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
  openChatSessions,
} from '../persistence/provider-sessions.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { reportedEfforts } from '../providers/efforts.ts';
import { recordAssistantEvent } from './assistant-events.ts';
import { clearFacts, listFacts } from './assistant-facts.ts';
import { assistantPick, type AssistantPick } from './assistant-model.ts';

interface PrefsRow {
  conversation_id: string | null;
  provider: ProviderId | null;
  model_choice: AssistantSettings['modelChoice'];
  model: string | null;
  effort: string | null;
  applied: string | null;
  notice: string | null;
}

interface AssistantTarget {
  provider: ProviderId;
  pick: AssistantPick;
  modelLabel: string | null;
}

export class AssistantSettingsError extends Error {}

async function prefsRow(db: Queryable, workspaceId: string): Promise<PrefsRow | null> {
  const { rows } = await db.query<PrefsRow>(
    `SELECT assistant_conversation_id AS conversation_id, assistant_provider AS provider,
       assistant_model_choice AS model_choice, assistant_model AS model,
       assistant_effort AS effort, assistant_applied AS applied, assistant_notice AS notice
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0] ?? null;
}

function settingsOf(row: PrefsRow): AssistantSettings {
  return {
    provider: row.provider,
    modelChoice: row.model_choice,
    model: row.model,
    effort: row.effort,
  };
}

export async function assistantConversationId(
  db: Queryable,
  workspaceId: string,
): Promise<string | null> {
  return (await prefsRow(db, workspaceId))?.conversation_id ?? null;
}

async function connectedProviders(db: Queryable, workspaceId: string): Promise<ProviderId[]> {
  const { rows } = await db.query<{ provider: ProviderId }>(
    `SELECT provider FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL ORDER BY provider`,
    [workspaceId],
  );
  return rows.map((row) => row.provider);
}

async function assistantTarget(
  db: Queryable,
  workspaceId: string,
  settings: AssistantSettings,
): Promise<AssistantTarget | null> {
  const connected = await connectedProviders(db, workspaceId);
  const provider =
    settings.provider && connected.includes(settings.provider)
      ? settings.provider
      : (await draftChatSettings(db, workspaceId)).provider;
  if (!provider) return null;
  const capabilities = await getCapabilities(db, workspaceId, provider);
  const offered = (capabilities?.models ?? []).filter((model) => model.availability !== 'unusable');
  const efforts = reportedEfforts(provider, capabilities?.efforts ?? null).map(
    (effort) => effort.id,
  );
  const pick = assistantPick(settings, provider, offered, efforts);
  const option = offered.find((model) => model.id === pick.model);
  const modelLabel = option ? (cardFor(option, provider)?.label ?? option.label) : null;
  return { provider, pick, modelLabel };
}

function fingerprint(target: AssistantTarget): string {
  return JSON.stringify([target.provider, target.pick.model, target.pick.effort]);
}

function runsOnLine(target: AssistantTarget): string {
  const parts = [catalogEntry(target.provider).name, target.modelLabel ?? 'default model'];
  if (target.pick.effort) parts.push(`${target.pick.effort} effort`);
  return parts.join(' · ');
}

function movedNotice(from: ProviderId, to: ProviderId): string {
  return `Ask Spark moved from ${catalogEntry(from).name} to ${catalogEntry(to).name}. Its new session starts from a summary of the old one.`;
}

export async function followAssistantSettings(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const prefs = await prefsRow(db, workspaceId);
  if (!prefs) return;
  const target = await assistantTarget(db, workspaceId, settingsOf(prefs));
  if (!target) return;
  const current = await resolveChatSettings(db, conversationId);
  const readOnly = modeForLegacy(target.provider, null, null);
  const applied = fingerprint(target);
  const changes = applied !== prefs.applied;
  if (!changes && target.provider === current.provider && current.agentMode === readOnly) return;
  const saved = await updateChatSettings(db, conversationId, {
    provider: target.provider,
    ...(readOnly ? { agentMode: readOnly } : {}),
    ...(changes
      ? {
          model: target.pick.model,
          effort: target.pick.effort,
          routing: target.pick.model ? 'pinned' : 'auto',
        }
      : {}),
  })
    .then(() => true)
    .catch(() => false);
  if (!saved || !changes) return;
  const sessions = await openChatSessions(db, conversationId);
  const moved =
    current.provider !== null &&
    current.provider !== target.provider &&
    sessions.some((session) => session.provider === current.provider);
  await db.query(
    `UPDATE profiles SET assistant_applied = $2, assistant_notice = $3 WHERE workspace_id = $1`,
    [
      workspaceId,
      applied,
      moved && current.provider ? movedNotice(current.provider, target.provider) : null,
    ],
  );
  if (prefs.applied !== null) {
    await recordAssistantEvent(db, workspaceId, 'settings_changed', runsOnLine(target));
  }
}

async function sessionOf(
  db: Queryable,
  conversationId: string | null,
  provider: ProviderId | null,
): Promise<AssistantSession | null> {
  if (!conversationId) return null;
  const sessions = await openChatSessions(db, conversationId);
  const session = sessions.find((entry) => entry.provider === provider) ?? sessions[0];
  if (!session) return null;
  const reading = readingOf(session.contextUsed, session.contextSize);
  return {
    provider: session.provider,
    startedAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    contextPercent: reading ? usedPercent(reading) : null,
  };
}

function runsOnOf(target: AssistantTarget | null): AssistantRunsOn | null {
  if (!target) return null;
  return {
    provider: target.provider,
    model: target.pick.model,
    modelLabel: target.modelLabel,
    effort: target.pick.effort,
    fastEffort: target.pick.fastEffort,
    noFastModel: target.pick.noFastModel,
  };
}

export async function assistantView(
  db: Queryable,
  workspaceId: string,
): Promise<AssistantSettingsView> {
  const prefs = await prefsRow(db, workspaceId);
  if (!prefs) throw new AssistantSettingsError('Finish setting up Spark first.');
  const settings = settingsOf(prefs);
  const target = await assistantTarget(db, workspaceId, settings);
  return {
    settings,
    runsOn: runsOnOf(target),
    conversationId: prefs.conversation_id,
    session: await sessionOf(db, prefs.conversation_id, target?.provider ?? null),
    facts: await listFacts(db, workspaceId),
    notice: prefs.notice,
    busy: await answering(db, prefs.conversation_id),
  };
}

async function assertSettings(
  db: Queryable,
  workspaceId: string,
  settings: AssistantSettings,
): Promise<void> {
  if (settings.provider) {
    const connected = await connectedProviders(db, workspaceId);
    if (!connected.includes(settings.provider)) {
      throw new InvalidDefaultError('Connect this provider before Ask Spark uses it.');
    }
  }
  if (settings.modelChoice === 'pick' && !settings.model) {
    throw new InvalidDefaultError('Pick a model for Ask Spark.');
  }
}

export async function saveAssistantSettings(
  db: Queryable,
  workspaceId: string,
  settings: AssistantSettings,
): Promise<AssistantSettingsView> {
  await assertSettings(db, workspaceId, settings);
  const { rows } = await db.query<{ conversation_id: string | null }>(
    `UPDATE profiles SET assistant_provider = $2, assistant_model_choice = $3,
       assistant_model = $4, assistant_effort = $5, updated_at = now()
     WHERE workspace_id = $1 RETURNING assistant_conversation_id AS conversation_id`,
    [
      workspaceId,
      settings.provider,
      settings.modelChoice,
      settings.modelChoice === 'pick' ? settings.model : null,
      settings.effort,
    ],
  );
  const row = rows[0];
  if (!row) throw new AssistantSettingsError('Finish setting up Spark first.');
  if (row.conversation_id) await followAssistantSettings(db, workspaceId, row.conversation_id);
  return assistantView(db, workspaceId);
}

export const ASSISTANT_BUSY = 'Wait for Ask Spark to finish answering first.';

async function answering(db: Queryable, conversationId: string | null): Promise<boolean> {
  if (!conversationId) return false;
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs WHERE conversation_id = $1
         AND status IN ('queued', 'running', 'awaiting_approval')
     ) OR EXISTS (SELECT 1 FROM chat_queue WHERE conversation_id = $1) AS busy`,
    [conversationId],
  );
  return rows[0]?.busy === true;
}

export async function clearAssistantHistory(
  db: Queryable,
  workspaceId: string,
  options: { facts: boolean },
): Promise<AssistantSettingsView> {
  const prefs = await prefsRow(db, workspaceId);
  if (!prefs) throw new AssistantSettingsError('Finish setting up Spark first.');
  if (prefs.conversation_id) {
    await db.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [prefs.conversation_id]);
    if (await answering(db, prefs.conversation_id))
      throw new AssistantSettingsError(ASSISTANT_BUSY);
    await closeConversationSessions(
      db,
      workspaceId,
      prefs.conversation_id,
      SESSION_CLOSE_REASONS.fresh,
    );
  }
  await db.query(
    `UPDATE profiles SET assistant_history_from = clock_timestamp(), assistant_notice = NULL
     WHERE workspace_id = $1`,
    [workspaceId],
  );
  if (options.facts) await clearFacts(db, workspaceId);
  await recordAssistantEvent(
    db,
    workspaceId,
    'history_cleared',
    options.facts ? 'key facts cleared too' : 'key facts kept',
  );
  return assistantView(db, workspaceId);
}
