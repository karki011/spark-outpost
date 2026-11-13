import type { Queryable } from '../persistence/db.ts';
import { crewSparksDir } from './folders.ts';
import { hasSparkInstructions, writeSparkInstructions } from './spark-folder.ts';

interface UnmovedRow {
  id: string;
  instructions: string;
}

export interface MoveResult {
  moved: number;
  failed: string[];
}

async function moveOne(db: Queryable, sparksDir: string, row: UnmovedRow): Promise<void> {
  const text = row.instructions.trim();
  if (text && !(await hasSparkInstructions(sparksDir, row.id))) {
    await writeSparkInstructions(sparksDir, row.id, text);
  }
  await db.query(
    `UPDATE teammates SET instructions = '', instructions_moved_at = now()
     WHERE id = $1 AND instructions_moved_at IS NULL`,
    [row.id],
  );
}

export async function moveInstructionsToFolders(
  db: Queryable,
  sparksDir: string = crewSparksDir(),
): Promise<MoveResult> {
  const { rows } = await db.query<UnmovedRow>(
    'SELECT id, instructions FROM teammates WHERE instructions_moved_at IS NULL ORDER BY created_at, id',
  );
  const result: MoveResult = { moved: 0, failed: [] };
  for (const row of rows) {
    try {
      await moveOne(db, sparksDir, row);
      result.moved += 1;
    } catch {
      result.failed.push(row.id);
    }
  }
  return result;
}
