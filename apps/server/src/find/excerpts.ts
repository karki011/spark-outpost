import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactText, storableText } from '../audit/redact.ts';
import { MAX_FILE_BYTES } from '../codescan/skip.ts';
import { CODE_CONTEXT, type ContextExcerpt, type ExcerptTarget } from './context-block.ts';
import { shareable } from './leads.ts';

async function readSource(root: string, path: string): Promise<string | null> {
  try {
    const file = join(root, path);
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    const text = await readFile(file, 'utf8');
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

export function excerptOf(
  text: string,
  target: ExcerptTarget,
  maxLines: number = CODE_CONTEXT.excerptLines,
): ContextExcerpt | null {
  const { declaration, path } = target;
  const all = text.split(/\r?\n/);
  if (declaration.startLine > all.length) return null;
  const end = Math.min(declaration.endLine, declaration.startLine + maxLines - 1, all.length);
  const raw = all.slice(declaration.startLine - 1, end);
  if (!raw.some((line) => line.includes(declaration.name))) return null;
  const lines = storableText(redactText(raw.join('\n'))).split('\n');
  return { path, name: declaration.name, startLine: declaration.startLine, lines };
}

export async function readExcerpts(
  root: string,
  targets: readonly ExcerptTarget[],
  ignore: readonly string[],
): Promise<ContextExcerpt[]> {
  const excerpts: ContextExcerpt[] = [];
  for (const target of targets) {
    if (!shareable(target.path, ignore)) continue;
    const text = await readSource(root, target.path);
    const excerpt = text === null ? null : excerptOf(text, target);
    if (excerpt) excerpts.push(excerpt);
  }
  return excerpts;
}
