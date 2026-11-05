import type { MapFileKind } from '@spark-outpost/contracts';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { declarationsIn, type IndexedDeclaration } from '../codescan/scan-store.ts';
import { isSkipped } from '../codescan/skip.ts';
import type { RequestTerms } from '../codescan/terms.ts';
import { fileAreas } from '../map/file-areas.ts';
import type { Queryable } from '../persistence/db.ts';
import { isSecretPath } from '../projects/path-policy.ts';

export const LEAD_DECLARATIONS = 5;

export interface LeadDeclaration extends IndexedDeclaration {
  matched: boolean;
}

export interface CodeLead {
  path: string;
  score: number;
  reasons: string[];
  package: string;
  lines: number | null;
  area: string | null;
  kind: MapFileKind | null;
  declarations: LeadDeclaration[];
}

export interface CodeLeads {
  leads: CodeLead[];
  withoutRanges: number;
  onMap: boolean;
}

export interface LeadOptions {
  ignore: readonly string[];
  limit: number;
  under?: string | undefined;
  declarations?: number;
  order?: readonly string[] | undefined;
  relevant?: ((path: string) => boolean) | undefined;
}

export function leadLabel(declaration: Pick<IndexedDeclaration, 'name' | 'startLine' | 'endLine'>) {
  return `${declaration.name}@${declaration.startLine}-${declaration.endLine}`;
}

export function isUnder(path: string, under: string | undefined): boolean {
  if (!under) return true;
  return path === under || path.startsWith(`${under}/`);
}

export function shareable(path: string, ignore: readonly string[]): boolean {
  return !isSecretPath(path, ignore) && !isSkipped(path);
}

function requestWords(report: Pick<ScanReport, 'terms'>): string[] {
  const terms: RequestTerms = report.terms;
  return [...terms.words, ...terms.identifiers].map((word) => word.toLowerCase());
}

export function pickDeclarations(
  declarations: readonly IndexedDeclaration[],
  report: Pick<ScanReport, 'terms' | 'summary'>,
  limit: number = LEAD_DECLARATIONS,
): LeadDeclaration[] {
  const named = new Set(report.summary.namedSymbols.map((symbol) => symbol.name));
  const words = requestWords(report);
  const marked = declarations.map((declaration) => {
    const lower = declaration.name.toLowerCase();
    const matched = named.has(declaration.name) || words.some((word) => lower.includes(word));
    return { ...declaration, matched };
  });
  return marked
    .sort(
      (a, b) =>
        Number(b.matched) - Number(a.matched) ||
        b.refFiles - a.refFiles ||
        a.startLine - b.startLine,
    )
    .slice(0, limit);
}

function inOrder(files: readonly RankedFile[], order: readonly string[] | undefined) {
  if (!order || order.length === 0) return [...files];
  const position = new Map(order.map((path, index) => [path, index]));
  const rank = (file: RankedFile) => position.get(file.path) ?? order.length;
  return files.toSorted((a, b) => rank(a) - rank(b));
}

export function leadFiles(report: ScanReport, options: LeadOptions): RankedFile[] {
  const relevant = options.relevant ?? (() => true);
  return inOrder(report.candidates, options.order)
    .filter(
      (file) =>
        shareable(file.path, options.ignore) &&
        isUnder(file.path, options.under) &&
        relevant(file.path),
    )
    .slice(0, options.limit);
}

export async function codeLeads(
  db: Queryable,
  root: string,
  report: ScanReport,
  options: LeadOptions,
): Promise<CodeLeads> {
  const files = leadFiles(report, options);
  const paths = files.map((file) => file.path);
  const [declared, areas] = await Promise.all([
    declarationsIn(db, root, paths),
    fileAreas(db, root, paths),
  ]);
  const leads = files.map((file): CodeLead => {
    const area = areas.get(file.path);
    return {
      path: file.path,
      score: file.score,
      reasons: file.reasons,
      package: file.package,
      lines: file.lines,
      area: area?.area ?? null,
      kind: area?.kind ?? null,
      declarations: pickDeclarations(
        declared.get(file.path) ?? [],
        report,
        options.declarations ?? LEAD_DECLARATIONS,
      ),
    };
  });
  return {
    leads,
    withoutRanges: paths.filter((path) => declared.get(path) === null).length,
    onMap: areas.size > 0,
  };
}
