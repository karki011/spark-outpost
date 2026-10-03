import {
  CODE_CONTEXT,
  excerptTargets,
  renderCodeContext,
  type CodeContextMode,
} from '../find/context-block.ts';
import { readExcerpts } from '../find/excerpts.ts';
import { codeLeads, leadLabel } from '../find/leads.ts';
import { findIssues, findStatus } from '../find/status.ts';
import { readIgnore } from '../projects/project-fs.ts';
import { awaitRanking, likelyFilesLine } from './likely-files.ts';
import type { Session } from './session.ts';

type ContextSession = Pick<Session, 'deps' | 'scan' | 'scanRoot' | 'ranking'>;
type Relevant = (path: string) => boolean;

async function contextBlock(s: ContextSession, relevant?: Relevant): Promise<string | null> {
  const outcome = s.scan ? await s.scan : null;
  const report = outcome?.report;
  if (!outcome || !report || !s.scanRoot) return null;
  const ranking = await awaitRanking(s, CODE_CONTEXT.rankingGraceMs);
  const ignore = await readIgnore(s.scanRoot);
  const found = await codeLeads(s.deps.db, s.scanRoot, report, {
    ignore,
    limit: CODE_CONTEXT.files,
    declarations: CODE_CONTEXT.declarationsPerFile,
    order: ranking?.predicted,
    relevant,
  });
  const excerpts = CODE_CONTEXT.excerpts
    ? await readExcerpts(s.scanRoot, excerptTargets(found.leads), ignore)
    : [];
  const rendered = renderCodeContext({
    status: findStatus(outcome, found),
    issues: findIssues(outcome, found),
    leads: found.leads,
    ...(ranking ? { probabilities: ranking.probabilities } : {}),
    excerpts,
  });
  return rendered?.text ?? null;
}

export async function declarationLeads(
  s: Pick<Session, 'deps' | 'scanReport' | 'scanRoot'>,
  paths: readonly string[],
): Promise<Map<string, string[]>> {
  const report = s.scanReport;
  if (!CODE_CONTEXT.leads || !report || !s.scanRoot || paths.length === 0) return new Map();
  try {
    const wanted = new Set(paths);
    const found = await codeLeads(s.deps.db, s.scanRoot, report, {
      ignore: await readIgnore(s.scanRoot),
      limit: paths.length,
      declarations: CODE_CONTEXT.declarationsPerFile,
      relevant: (path) => wanted.has(path),
    });
    return new Map(found.leads.map((lead) => [lead.path, lead.declarations.map(leadLabel)]));
  } catch (error) {
    console.error('Could not load declaration leads', error);
    return new Map();
  }
}

export async function codeContextFor(
  s: ContextSession,
  mode: CodeContextMode,
  relevant?: Relevant,
): Promise<string | null> {
  if (mode === 'line') return likelyFilesLine(await awaitRanking(s), relevant);
  try {
    return await contextBlock(s, relevant);
  } catch (error) {
    console.error('Could not build the code context', error);
    return null;
  }
}

export function codeContext(s: ContextSession, relevant?: Relevant): Promise<string | null> {
  return codeContextFor(s, CODE_CONTEXT.mode, relevant);
}
