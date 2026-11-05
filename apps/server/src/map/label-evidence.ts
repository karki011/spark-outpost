import { redactText, storableText } from '../audit/redact.ts';
import { estimateTokens, evidenceBlock } from '../codescan/jev-state.ts';
import { isSkipped } from '../codescan/skip.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { LABEL_EVIDENCE_TOKENS, LABEL_FILE_TOKENS, LABEL_PATHS } from './policy.ts';

export type ReadContent = (path: string) => Promise<string | null>;

export interface EvidenceInput {
  facts: readonly string[];
  rankedPaths: readonly string[];
  ignore: readonly string[];
  read: ReadContent;
  budget?: number;
}

export interface AreaEvidence {
  text: string;
  tokens: number;
  paths: number;
  contents: string[];
}

const CHARS_PER_TOKEN = 4;

export function sendable(path: string, ignore: readonly string[]): boolean {
  return !isSecretPath(path, ignore) && !isSkipped(path);
}

export function fileBlock(path: string, text: string, budgetTokens: number): string {
  const limit = budgetTokens * CHARS_PER_TOKEN;
  const clean = storableText(redactText(text));
  const body =
    clean.length > limit ? `${clean.slice(0, limit)}\n[cut at ${limit} characters]` : clean;
  return `--- file: ${path} ---\n${body}`;
}

export async function areaEvidence(input: EvidenceInput): Promise<AreaEvidence> {
  const budget = input.budget ?? LABEL_EVIDENCE_TOKENS;
  const safe = input.rankedPaths.filter((path) => sendable(path, input.ignore));
  const listed = safe.slice(0, LABEL_PATHS);
  const lines = [
    ...input.facts,
    `Files by importance (${listed.length} of ${safe.length}):`,
    ...listed.map((path) => `- ${path}`),
  ];
  let used = estimateTokens(evidenceBlock(lines));
  const contents: string[] = [];
  for (const path of safe) {
    const remaining = budget - used;
    if (remaining < 200) break;
    const text = await input.read(path);
    if (text === null || text.trim() === '' || text.includes('\u0000')) continue;
    const block = fileBlock(path, text, Math.min(LABEL_FILE_TOKENS, remaining - 50));
    lines.push(block);
    contents.push(path);
    used += estimateTokens(block) + 1;
  }
  const text = evidenceBlock(lines);
  return { text, tokens: estimateTokens(text), paths: listed.length, contents };
}
