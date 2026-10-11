import { z } from 'zod';

export const buildStyleSchema = z.enum(['off', 'lite', 'lean']);
export const SHORTCUTS_MAX = 100;

export const shortcutSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().nullable(),
  ceiling: z.string(),
  upgrade: z.string().nullable(),
});
export type Shortcut = z.infer<typeof shortcutSchema>;

export const shortcutsBodySchema = z.object({
  runId: z.uuid(),
  style: buildStyleSchema,
  entries: z.array(shortcutSchema).max(SHORTCUTS_MAX),
});
export type ShortcutsBody = z.infer<typeof shortcutsBodySchema>;

export function shortcutText(entry: Shortcut): string {
  const where = entry.line === null ? entry.path : `${entry.path}:${entry.line}`;
  const upgrade = entry.upgrade ? `upgrade: ${entry.upgrade}` : 'no trigger';
  return `${where}, ${entry.ceiling}. ${upgrade}.`;
}

export function shortcutsLine(body: ShortcutsBody): string {
  const count = body.entries.length;
  const untriggered = body.entries.filter((entry) => entry.upgrade === null).length;
  const noun = count === 1 ? 'shortcut' : 'shortcuts';
  const rot = untriggered > 0 ? `, ${untriggered} with no upgrade trigger` : '';
  return `Deferred ${noun}: ${count} marked lean:${rot}`;
}
