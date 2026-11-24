import { approvalPayloadSchema, holdsToConfirm, type ApprovalPayload } from './approvals.ts';
import { atlassianDeletes } from './atlassian-actions.ts';
import { isCalendarAction } from './calendar-actions.ts';
import {
  REMOTE_CARD_KIND_LABELS,
  REMOTE_SWITCH_LABELS,
  type RemoteCardAnswering,
  type RemoteCardKind,
  type RemoteSwitch,
  type RemoteSwitches,
} from './remote.ts';
import { isSecretFileName } from './secret-files.ts';
import { serviceNowAsksAlways } from './servicenow-actions.ts';
import { isMacAction } from './spark-actions.ts';

export function remoteKindOn(answering: RemoteCardAnswering, kind: RemoteCardKind): boolean {
  return answering.from === 'devices' && !answering.macOnly.includes(kind);
}

export function remoteSwitchRefusal(name: RemoteSwitch): string {
  return `Turned off for remote control on your Mac: ${REMOTE_SWITCH_LABELS[name]}.`;
}

function parsed(payload: unknown): ApprovalPayload | null {
  const result = approvalPayloadSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function remoteCardKind(card: ApprovalPayload): RemoteCardKind | null {
  const action = card.sparkAction?.action;
  if (action === undefined) return null;
  if (action === 'rules_edit') return 'rules';
  if (action === 'plugins_edit') return 'plugins';
  if (
    action === 'crew_edit' ||
    action === 'create_teammate' ||
    action === 'update_teammate' ||
    action === 'delete_teammate' ||
    action === 'workflow_control'
  ) {
    return 'crew';
  }
  if (isMacAction(action)) return 'macControl';
  return isCalendarAction(action) ? 'calendar' : null;
}

function fixedOnMac(card: ApprovalPayload): boolean {
  if (card.openAddress) return true;
  const action = card.sparkAction;
  if (action?.action === 'browser_handoff') return true;
  return action?.action === 'rules_edit' && action.target === 'managed';
}

export function macOnlyCard(payload: unknown): boolean {
  const card = parsed(payload);
  if (!card) return false;
  return fixedOnMac(card) || remoteCardKind(card) !== null;
}

function baseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export function cardSwitch(payload: unknown): RemoteSwitch | null {
  const card = parsed(payload);
  if (!card) return 'highRiskCards';
  const action = card.sparkAction;
  if (action?.action === 'browser_sign_in') return 'signIns';
  if (action?.action === 'link_repo' || action?.action === 'clone_repo') return 'projects';
  if (action?.action === 'ask_spark' && action.op === 'answer_card') return 'highRiskCards';
  const editsAtlassian = action?.action === 'jira_edit' || action?.action === 'confluence_edit';
  if (editsAtlassian && atlassianDeletes(action)) return 'highRiskCards';
  if (action && serviceNowAsksAlways(action)) return 'highRiskCards';
  const paths = [...card.paths, ...(card.fullPaths ?? [])];
  const highRisk =
    card.gitControl !== undefined ||
    card.forcePush !== undefined ||
    card.instructionFiles !== undefined ||
    paths.some((path) => isSecretFileName(baseName(path)));
  return highRisk ? 'highRiskCards' : null;
}

export function cardNeedsStepUp(card: ApprovalPayload): boolean {
  const kind = remoteCardKind(card);
  return kind === 'rules' || kind === 'macControl' || holdsToConfirm(card);
}

export const FIXED_ON_MAC_REASON =
  'This card acts on the Mac itself, so it is answered there. Your Mac shows it too.';
export const STEP_UP_NEEDS_PASSKEY =
  'This card needs your passkey on this device. Save one under Remote control on this device, or answer on your Mac.';
export const STEP_UP_REQUIRED = 'Confirm with your passkey first.';

export function kindOnMacReason(kind: RemoteCardKind): string {
  return `${REMOTE_CARD_KIND_LABELS[kind]} cards are answered on your Mac. Change this in Remote control on the Mac.`;
}

export interface RemoteCardContext {
  switches: RemoteSwitches;
  answering: RemoteCardAnswering;
  passkey: boolean;
}

export type RemoteCardPlace =
  | { place: 'here' }
  | { place: 'step_up' }
  | { place: 'mac'; reason: string; switch?: RemoteSwitch };

export function remoteCardPlace(payload: unknown, context: RemoteCardContext): RemoteCardPlace {
  const card = parsed(payload);
  if (!card) {
    return context.switches.highRiskCards
      ? { place: 'here' }
      : { place: 'mac', reason: remoteSwitchRefusal('highRiskCards'), switch: 'highRiskCards' };
  }
  if (fixedOnMac(card)) return { place: 'mac', reason: FIXED_ON_MAC_REASON };
  const kind = remoteCardKind(card);
  if (kind && !remoteKindOn(context.answering, kind)) {
    return { place: 'mac', reason: kindOnMacReason(kind) };
  }
  const needed = cardSwitch(card);
  if (needed && !context.switches[needed]) {
    return { place: 'mac', reason: remoteSwitchRefusal(needed), switch: needed };
  }
  if (!cardNeedsStepUp(card)) return { place: 'here' };
  return context.passkey ? { place: 'step_up' } : { place: 'mac', reason: STEP_UP_NEEDS_PASSKEY };
}
