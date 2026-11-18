import { z } from 'zod';
import { isLoopbackHost } from './custom-endpoint.ts';
import { parseUrl } from './url.ts';

export const SHARE_URL_ENV = 'SPARK_SHARE_URL';
export const ARTIFACT_SHARE_DAYS = [1, 7] as const;
export const ARTIFACT_SHARE_DEFAULT_DAYS = 7;
export const ARTIFACT_SHARE_PASSCODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ARTIFACT_SHARE_PASSCODE_LENGTH = 8;
export const ARTIFACT_SHARE_ID_BYTES = 16;
export const ARTIFACT_SHARE_ID_DOMAIN = 'spark-share-id:';
export const ARTIFACT_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const ARTIFACT_SHARE_DELETE_TOKEN_BYTES = 32;
export const ARTIFACT_SHARE_DELETE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ARTIFACT_SHARE_FINAL_HEADER = 'x-share-final';

export function shareServiceOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  const url = parseUrl(trimmed);
  if (!url || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url.origin;
  return null;
}

export function displayPasscode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export const artifactShareDaysSchema = z.literal(ARTIFACT_SHARE_DAYS);
export type ArtifactShareDays = z.infer<typeof artifactShareDaysSchema>;

export const artifactShareSchema = z.object({
  shareId: z.string(),
  version: z.number().int().positive(),
  url: z.string(),
  expiresAt: z.string(),
  hasPasscode: z.boolean(),
  createdAt: z.string(),
});
export type ArtifactShare = z.infer<typeof artifactShareSchema>;

export const artifactShareStatusSchema = z.object({
  available: z.boolean(),
  share: artifactShareSchema.nullable(),
});
export type ArtifactShareStatus = z.infer<typeof artifactShareStatusSchema>;

export const ARTIFACT_SHARE_THEME_COLORS = [
  'bg',
  'card',
  'text',
  'muted',
  'line',
  'accent',
  'accentInk',
  'ok',
  'bad',
  'strip',
] as const;
export const ARTIFACT_SHARE_THEME_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const themeColorSchema = z.string().regex(ARTIFACT_SHARE_THEME_COLOR_PATTERN);

export const artifactShareThemeSchema = z.strictObject({
  scheme: z.enum(['light', 'dark']),
  bg: themeColorSchema,
  card: themeColorSchema,
  text: themeColorSchema,
  muted: themeColorSchema,
  line: themeColorSchema,
  accent: themeColorSchema,
  accentInk: themeColorSchema,
  ok: themeColorSchema,
  bad: themeColorSchema,
  strip: themeColorSchema,
});
export type ArtifactShareTheme = z.infer<typeof artifactShareThemeSchema>;

export const createArtifactShareRequestSchema = z.object({
  expiresInDays: artifactShareDaysSchema,
  passcode: z.boolean(),
  theme: artifactShareThemeSchema.optional(),
});
export type CreateArtifactShareRequest = z.infer<typeof createArtifactShareRequestSchema>;

export const createdArtifactShareSchema = z.object({
  share: artifactShareSchema,
  passcode: z.string().nullable(),
});
export type CreatedArtifactShare = z.infer<typeof createdArtifactShareSchema>;

export const alreadySharedSchema = z.object({
  error: z.string(),
  share: artifactShareSchema,
});

export function artifactSharePath(id: string, version: number): string {
  return `/artifacts/${id}/versions/${version}/share`;
}
