import {
  buildStyleSchema,
  DEFAULT_BUILD_STYLE,
  type ShortcutsBody,
} from '@spark-outpost/contracts';
import { nextArtifactVersion } from '../persistence/artifacts.ts';
import type { Queryable } from '../persistence/db.ts';
import { runEvents } from '../workflow/run-events.ts';
import { harvestShortcuts, ruleBuildStyle, type ProjectStyle } from './lean.ts';
import { changesSoFar } from './member-prompts.ts';
import type { Session } from './session.ts';

export const NO_PROJECT_STYLE: ProjectStyle = { style: 'off', source: 'project setting' };

export async function projectBuildStyle(db: Queryable, runId: string): Promise<ProjectStyle> {
  const { rows } = await db.query<{ build_style: string | null }>(
    `SELECT p.build_style FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     JOIN projects p ON p.id = cp.project_id
     WHERE r.id = $1
     ORDER BY cp.position, cp.created_at
     LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return NO_PROJECT_STYLE;
  if (row.build_style === null) return { style: DEFAULT_BUILD_STYLE, source: 'default' };
  const style = buildStyleSchema.catch(DEFAULT_BUILD_STYLE).parse(row.build_style);
  return { style, source: 'project setting' };
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
  const version = await nextArtifactVersion(s.deps.db, s.taskId, 'shortcuts');
  await s.append(runEvents.activity('artifact:shortcuts', 'shortcuts', { version, body }), {
    artifact: {
      taskId: s.taskId,
      kind: 'shortcuts',
      body,
      version,
      overwrite: false,
      supersedesPrevious: false,
    },
  });
  return body;
}
