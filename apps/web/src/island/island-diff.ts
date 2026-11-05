import { isSecretFileName, type Approval, type FileDiff } from '@spark-outpost/contracts';
import {
  foldRows,
  shownRows,
  type DiffModel,
  type DiffRow,
  type ShownRows,
} from '../chat/approvals/diff-model.ts';

export const PEEK_ROWS = 80;
export const HUNK_ROWS = 10;
const HUNK_LEAD = 2;
const ALL_FOLDED: ReadonlySet<number> = new Set();

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
const SECRET_REASON = /secret/i;

export function peekRows(model: DiffModel, cap = PEEK_ROWS): ShownRows {
  return shownRows(foldRows(model.rows), ALL_FOLDED, cap);
}

function fromFirstChange(rows: readonly DiffRow[]): DiffRow[] {
  const first = rows.findIndex((row) => row.kind !== 'same');
  return rows.slice(Math.max(0, first - HUNK_LEAD));
}

export function firstHunk(model: DiffModel, cap = HUNK_ROWS): ShownRows {
  const blocks = foldRows(model.rows).filter((block) => block.type === 'rows');
  const at = blocks.findIndex((block) => block.rows.some((row) => row.kind !== 'same'));
  if (at < 0) return { items: [], hidden: 0 };
  const hunk = fromFirstChange(blocks[at]!.rows);
  const later = blocks.slice(at + 1).reduce((sum, block) => sum + block.rows.length, 0);
  const shown = hunk.slice(0, cap);
  return {
    items: shown.map((row) => ({ type: 'row', row })),
    hidden: hunk.length - shown.length + later,
  };
}

export function approvalHunk(approval: Approval): FileDiff | null {
  if (approval.kind !== 'edit') return null;
  const { payload } = approval;
  if (payload.instructionFiles || payload.gitControl) return null;
  const reasons = [approval.reason, payload.asksBecause];
  if (reasons.some((reason) => reason && SECRET_REASON.test(reason))) return null;
  const paths = [...payload.paths, ...payload.diffs.map((diff) => diff.path)];
  if (paths.some((path) => isSecretFileName(baseName(path.replace(/\\/g, '/'))))) return null;
  return payload.diffs[0] ?? null;
}

export function moreLines(count: number): string {
  return `${count.toLocaleString('en-US')} more ${count === 1 ? 'line' : 'lines'}`;
}
