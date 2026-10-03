import { estimateTokens, evidenceBlock } from '../codescan/jev-state.ts';
import { leadLabel, type CodeLead, type LeadDeclaration } from './leads.ts';
import type { FindStatus } from './status.ts';

export type CodeContextMode = 'line' | 'block';

export const CODE_CONTEXT = {
  mode: 'block' as CodeContextMode,
  leads: true,
  excerpts: true,
  budgetTokens: 1_200,
  files: 8,
  declarationsPerFile: 4,
  maxExcerpts: 3,
  excerptLines: 12,
  minExcerptLines: 3,
  lineChars: 160,
  rankingGraceMs: 1_500,
} as const;

export interface ContextOptions {
  leads: boolean;
  excerpts: boolean;
  budgetTokens: number;
}

export interface ContextExcerpt {
  path: string;
  name: string;
  startLine: number;
  lines: string[];
}

export interface ContextInput {
  status: FindStatus;
  issues: readonly string[];
  leads: readonly CodeLead[];
  probabilities?: ReadonlyMap<string, number>;
  excerpts: readonly ContextExcerpt[];
}

export interface CodeContext {
  text: string;
  tokens: number;
  files: number;
  leadFiles: number;
  excerpts: number;
}

export interface ExcerptTarget {
  path: string;
  declaration: LeadDeclaration;
}

const STATUS_TEXT: Record<FindStatus, string> = {
  complete: 'complete',
  partial: 'partial, some matches may be missing',
  index_building: 'the code index is still building, so this list is incomplete',
};

const HINT = 'Likely code (a ranking hint, not a limit)';
const TAG = /<(\/?)code_evidence>/gi;

function safeLine(text: string): string {
  const clipped =
    text.length > CODE_CONTEXT.lineChars ? `${text.slice(0, CODE_CONTEXT.lineChars)}…` : text;
  return clipped.replace(TAG, '<$1code-evidence>');
}

function fileLine(lead: CodeLead, position: number, probability: number | undefined): string {
  const parts = [`${position}. ${lead.path}`, lead.kind ?? '?', lead.area ?? '?'];
  if (lead.reasons.length > 0) parts.push(lead.reasons.join(', '));
  if (probability !== undefined) parts.push(`Jev ${probability.toFixed(2)}`);
  return safeLine(parts.join(' | '));
}

function declarationLine(lead: CodeLead): string | null {
  const shown = lead.declarations.slice(0, CODE_CONTEXT.declarationsPerFile);
  if (shown.length === 0) return null;
  return safeLine(`${lead.path}: ${shown.map(leadLabel).join(', ')}`);
}

export function excerptTargets(
  leads: readonly CodeLead[],
  limit: number = CODE_CONTEXT.maxExcerpts,
): ExcerptTarget[] {
  return leads
    .flatMap((lead) =>
      lead.declarations
        .filter((declaration) => declaration.matched)
        .map((declaration) => ({ path: lead.path, declaration })),
    )
    .slice(0, limit);
}

class Budget {
  readonly lines: string[] = [];
  private used: number;

  constructor(private readonly limit: number) {
    this.used = estimateTokens(evidenceBlock([]));
  }

  fits(lines: readonly string[]): boolean {
    const cost = lines.reduce((sum, line) => sum + estimateTokens(line) + 1, 0);
    return this.used + cost <= this.limit;
  }

  add(lines: readonly string[]): boolean {
    if (!this.fits(lines)) return false;
    for (const line of lines) {
      this.lines.push(line);
      this.used += estimateTokens(line) + 1;
    }
    return true;
  }
}

function addSection(budget: Budget, heading: string, entries: readonly string[]): number {
  const [first, ...rest] = entries;
  if (first === undefined || !budget.add([heading, first])) return 0;
  let added = 1;
  for (const entry of rest) {
    if (!budget.add([entry])) break;
    added += 1;
  }
  return added;
}

function excerptLines(excerpt: ContextExcerpt): string[] {
  return excerpt.lines.map((line, index) => safeLine(`${excerpt.startLine + index}: ${line}`));
}

function addExcerpt(budget: Budget, excerpt: ContextExcerpt, first: boolean): boolean {
  const last = excerpt.startLine + excerpt.lines.length - 1;
  const heading = [
    ...(first ? ['Excerpts (verbatim, with line numbers):'] : []),
    safeLine(`--- ${excerpt.path}:${excerpt.startLine}-${last} (${excerpt.name}) ---`),
  ];
  const body = excerptLines(excerpt);
  const fewest = Math.min(body.length, CODE_CONTEXT.minExcerptLines);
  for (let keep = body.length; keep >= fewest; keep -= 1) {
    const cut = keep < body.length ? ['[cut]'] : [];
    if (budget.add([...heading, ...body.slice(0, keep), ...cut])) return true;
  }
  return false;
}

export function renderCodeContext(
  input: ContextInput,
  options: ContextOptions = CODE_CONTEXT,
): CodeContext | null {
  if (input.leads.length === 0) return null;
  const budget = new Budget(options.budgetTokens);
  budget.add([`${HINT}. Code scan: ${STATUS_TEXT[input.status]}.`]);
  budget.add(input.issues.slice(0, 2).map(safeLine));
  const files = addSection(
    budget,
    'Files (path | kind | area | why):',
    input.leads.map((lead, index) =>
      fileLine(lead, index + 1, input.probabilities?.get(lead.path)),
    ),
  );
  if (files === 0) return null;
  const shown = input.leads.slice(0, files);
  const declared = options.leads ? shown.flatMap((lead) => declarationLine(lead) ?? []) : [];
  const leadFiles = addSection(budget, 'Declarations (name@startLine-endLine):', declared);
  let excerpts = 0;
  const paths = new Set(shown.map((lead) => lead.path));
  for (const excerpt of options.excerpts ? input.excerpts : []) {
    if (!paths.has(excerpt.path) || excerpt.lines.length === 0) continue;
    if (!addExcerpt(budget, excerpt, excerpts === 0)) break;
    excerpts += 1;
  }
  const text = evidenceBlock(budget.lines);
  return { text, tokens: estimateTokens(text), files, leadFiles, excerpts };
}
