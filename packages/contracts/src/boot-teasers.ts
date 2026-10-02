import { z } from 'zod';

export const BOOT_TEASER_NAMES_MAX = 3;
export const BOOT_TEASER_NAME_MAX = 24;

const countSchema = z.number().int().nonnegative();
const namesSchema = z.array(z.string().min(1).max(BOOT_TEASER_NAME_MAX)).max(BOOT_TEASER_NAMES_MAX);

export const bootTeaserSnapshotSchema = z.strictObject({
  savedAt: z.iso.datetime({ offset: true }),
  running: countSchema,
  needsYou: countSchema,
  prs: countSchema,
  briefAt: z.iso.datetime({ offset: true }).nullable(),
  busy: namesSchema,
  waiting: namesSchema,
});
export type BootTeaserSnapshot = z.infer<typeof bootTeaserSnapshotSchema>;

export interface BootTeaser {
  label: string;
  text: string;
}
