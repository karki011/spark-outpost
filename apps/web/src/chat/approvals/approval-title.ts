import {
  humanizeToolName,
  isCheckApproval,
  parseMcpTool,
  sparkActionQuestion,
  type Approval,
} from '@spark-outpost/contracts';
import { commandSummary, fileName } from '../status/status-text.ts';

export interface CardTitle {
  before: string;
  code: string | null;
  after: string;
}

const TITLE_COMMAND_CHARS = 40;

function plain(text: string): CardTitle {
  return { before: text, code: null, after: '' };
}

function quoted(before: string, code: string): CardTitle {
  return { before, code, after: '?' };
}

function fixedTitle(approval: Approval): string | null {
  const { payload } = approval;
  if (payload.sparkAction) return sparkActionQuestion(payload.sparkAction);
  if (payload.plan) return 'Approve the plan?';
  if (payload.forcePush) return 'Force push?';
  if (payload.secretSend) return 'Send a secret value?';
  if (payload.gitControl) return 'Change git hooks or config?';
  if (payload.instructionFiles) return 'Change agent instructions?';
  if (isCheckApproval(approval)) return 'Run a check?';
  return null;
}

function editTitle(paths: readonly string[]): CardTitle {
  if (paths.length === 1) return quoted('Edit ', fileName(paths[0]!));
  return plain(paths.length === 0 ? 'Change files?' : `Edit ${paths.length} files?`);
}

function otherTitle(approval: Approval): CardTitle {
  const mcp = parseMcpTool(approval.title);
  if (mcp) return plain(`Use ${humanizeToolName(mcp.tool)} (${mcp.server})?`);
  return plain('Allow this action?');
}

export function cardTitle(approval: Approval): CardTitle {
  const fixed = fixedTitle(approval);
  if (fixed) return plain(fixed);
  const { command, paths } = approval.payload;
  if (approval.kind === 'execute') {
    return command
      ? quoted('Run ', commandSummary(command, TITLE_COMMAND_CHARS))
      : plain('Run a command?');
  }
  if (approval.kind === 'edit') return editTitle(paths);
  return otherTitle(approval);
}

export function titleText(title: CardTitle): string {
  return `${title.before}${title.code ?? ''}${title.after}`;
}
