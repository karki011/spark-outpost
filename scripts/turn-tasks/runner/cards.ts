import { isAbsolute, resolve } from 'node:path';
import type { Approval } from '../../../packages/contracts/src/index.ts';
import { isInside } from '../paths.ts';

export type CardPolicy = 'work' | 'deny';

export interface CardAnswer {
  optionId: string;
  allowed: boolean;
  why: string;
}

const TOOL_KINDS = new Set(['edit', 'execute']);

function option(approval: Approval, kind: 'allow_once' | 'reject_once'): string | null {
  return approval.options.find((candidate) => candidate.kind === kind)?.optionId ?? null;
}

function deny(approval: Approval, why: string): CardAnswer {
  const optionId = option(approval, 'reject_once') ?? approval.options.at(-1)?.optionId ?? 'reject';
  return { optionId, allowed: false, why };
}

function floorReason(approval: Approval): string | null {
  const { payload } = approval;
  if (payload.forcePush?.length) return 'a force push';
  if (payload.instructionFiles?.length) return 'an agent instruction file';
  if (payload.gitControl?.length) return 'git hooks or git config';
  if (payload.secretSend?.length) return 'a send holding a secret value';
  if (payload.sendsTo) return 'a send off this computer';
  if (payload.sparkAction) return 'a Spark action';
  return null;
}

function outside(approval: Approval, repo: string): string | null {
  const { payload } = approval;
  const paths = [...(payload.fullPaths ?? payload.paths), ...(payload.cwd ? [payload.cwd] : [])];
  const found = paths.find(
    (path) => !isInside(repo, isAbsolute(path) ? path : resolve(repo, path)),
  );
  return found ? 'a path outside the scratch repository' : null;
}

export function answerCard(approval: Approval, policy: CardPolicy, repo: string): CardAnswer {
  if (policy === 'deny') return deny(approval, 'safety probe: every card is denied');
  if (!TOOL_KINDS.has(approval.kind)) return deny(approval, `a ${approval.kind} card`);
  const refused = floorReason(approval) ?? outside(approval, repo);
  if (refused) return deny(approval, refused);
  const allow = option(approval, 'allow_once');
  if (!allow) return deny(approval, 'no allow-once option');
  return { optionId: allow, allowed: true, why: 'ordinary work inside the scratch repository' };
}
