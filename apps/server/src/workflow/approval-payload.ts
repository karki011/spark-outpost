import path from 'node:path';
import type { ApprovalPayload } from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import type { Asking } from './approval-options.ts';

const DIFF_BUDGET = 64 * 1024;

function relativeLabel(request: ApprovalRequest, target: string): string {
  for (const root of request.roots) {
    const relative = path.relative(root.path, target);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return request.roots.length > 1 ? `${path.basename(root.path)}/${relative}` : relative;
    }
  }
  return target;
}

export function displayTitle(request: ApprovalRequest): string {
  const title = request.title.trim() || 'an action';
  return request.paths.reduce(
    (text, target) => text.replaceAll(target, relativeLabel(request, target)),
    title,
  );
}

export function subject(request: ApprovalRequest): string {
  if (request.kind === 'execute' && request.command) {
    return `\`${request.command.replace(/\s+/g, ' ').trim()}\``;
  }
  if (request.kind === 'edit' && request.paths.length > 0) {
    const verb = request.toolKind === 'delete' ? 'Delete' : 'Edit';
    return `${verb} ${request.paths.map((target) => `\`${relativeLabel(request, target)}\``).join(', ')}`;
  }
  return request.title.trim() || 'an action';
}

export function approvalPayload(request: ApprovalRequest, asking: Asking): ApprovalPayload {
  let budget = DIFF_BUDGET;
  let truncated = false;
  const cut = (text: string) => {
    if (text.length <= budget) {
      budget -= text.length;
      return text;
    }
    truncated = true;
    const kept = text.slice(0, Math.max(0, budget));
    budget = 0;
    return kept;
  };
  const diffs = request.diffs.map((diff) => ({
    path: relativeLabel(request, diff.path),
    oldText: diff.oldText === null ? null : cut(diff.oldText),
    newText: cut(diff.newText),
  }));
  return {
    command: request.command,
    cwd: request.cwd,
    paths: request.paths.map((target) => relativeLabel(request, target)),
    fullPaths: request.paths,
    diffs,
    truncated,
    ...(request.plan ? { plan: request.plan } : {}),
    ...(asking.forcePush ? { forcePush: asking.forcePush } : {}),
    ...(asking.instructionFiles ? { instructionFiles: asking.instructionFiles } : {}),
    ...(asking.gitControl ? { gitControl: asking.gitControl } : {}),
    ...(asking.because ? { asksBecause: asking.because } : {}),
    ...(asking.observed ? { observed: asking.observed } : {}),
    ...(asking.sendsTo ? { sendsTo: asking.sendsTo } : {}),
    ...(asking.secretSend ? { secretSend: asking.secretSend } : {}),
    ...(request.agentReason ? { agentReason: request.agentReason } : {}),
  };
}
