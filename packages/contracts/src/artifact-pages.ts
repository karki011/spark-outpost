import { z } from 'zod';

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const ARTIFACT_TITLE_MAX = 120;
export const ARTIFACT_ACTIVITY = 'artifact';
export const ARTIFACT_URI_PREFIX = 'ui://spark/';
export const ARTIFACT_HTML_MIME = 'text/html;profile=mcp-app';
export const ARTIFACT_PORT_OFFSET = 10_000;
export const ARTIFACT_OPEN_PATH = '/open';
export const ARTIFACT_OPEN_PARAM = 'to';

export const artifactPageKindSchema = z.enum(['html', 'markdown', 'svg']);
export type ArtifactPageKind = z.infer<typeof artifactPageKindSchema>;

export const ARTIFACT_KIND_LABELS: Record<ArtifactPageKind, string> = {
  html: 'HTML',
  markdown: 'Markdown',
  svg: 'SVG',
};

export const ARTIFACT_FILE_EXTENSIONS: Record<ArtifactPageKind, string> = {
  html: 'html',
  markdown: 'md',
  svg: 'svg',
};

export const ARTIFACT_PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  'sandbox allow-scripts',
].join('; ');

export const ARTIFACT_FRAME_SANDBOX = 'allow-scripts';

const HIGHEST_PORT = 65_535;

export function artifactPortFor(apiPort: number): number {
  const above = apiPort + ARTIFACT_PORT_OFFSET;
  return above <= HIGHEST_PORT ? above : apiPort - ARTIFACT_PORT_OFFSET;
}

export function artifactOrigin(apiPort: number): string {
  return `http://127.0.0.1:${artifactPortFor(apiPort)}`;
}

export function artifactUri(conversationId: string, artifactId: string): string {
  return `${ARTIFACT_URI_PREFIX}${conversationId}/${artifactId}`;
}

const URI = /^ui:\/\/spark\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i;

export function parseArtifactUri(
  uri: string,
): { conversationId: string; artifactId: string } | null {
  const match = URI.exec(uri);
  return match ? { conversationId: match[1]!, artifactId: match[2]! } : null;
}

export const artifactVersionSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  bytes: z.number().int().nonnegative(),
  runId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

export const artifactPageSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: artifactPageKindSchema,
  versions: z.array(artifactVersionSchema),
});
export type ArtifactPage = z.infer<typeof artifactPageSchema>;

export const artifactViewSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  kind: artifactPageKindSchema,
  viewUrl: z.string().nullable(),
  text: z.string(),
});
export type ArtifactView = z.infer<typeof artifactViewSchema>;

export function artifactPath(id: string, version: number, part: 'view' | 'file' | 'page'): string {
  return `/artifacts/${id}/versions/${version}/${part}`;
}

export const publishArtifactActionSchema = z.object({
  action: z.literal('publish_artifact'),
  artifactId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(ARTIFACT_TITLE_MAX),
  kind: artifactPageKindSchema,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PublishArtifactAction = z.infer<typeof publishArtifactActionSchema>;

export const publishArtifactLabels = {
  publish_artifact: {
    question: 'Show this artifact in the chat?',
    confirm: 'Show it',
    doing: 'Saving the artifact…',
  },
};
