import { DEFAULT_BUILD_STYLE, type ShortcutsBody } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { harvestShortcuts, ruleBuildStyle, type ProjectStyle } from './lean.ts';
import { changesSoFar } from './member-prompts.ts';
import { appendNewArtifact, type Session } from './session.ts';

export const NO_PROJECT_STYLE: ProjectStyle = { style: 'off', source: 'project setting' };

export async function projectBuildStyle(db: Queryable, runId: string): Promise<ProjectStyle> {
  const { rows } = await db.query(
    `SELECT 1 FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     WHERE r.id = $1
     LIMIT 1`,
    [runId],
  );
  if (rows.length === 0) return NO_PROJECT_STYLE;
  return { style: DEFAULT_BUILD_STYLE, source: 'default' };
}

export function decideBuildStyle(s: Session): void {
  const { style, source } = s.projectStyle;
  s.buildStyle = ruleBuildStyle(style, s.input.mode, s.input.userRequest, source).style;
}

export async function recordShortcuts(s: Session): Promise<ShortcutsBody | null> {
  if (s.buildStyle === 'off' || !s.taskId) return null;
  const { patch } = await changesSoFar(s);
  const entries = harvestShortcuts(patch);
  if (entries.length === 0) return null;
  const body: ShortcutsBody = { runId: s.lease.runId, style: s.buildStyle, entries };
  await appendNewArtifact(s, s.taskId, 'shortcuts', body);
  return body;
}
